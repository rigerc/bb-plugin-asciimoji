import { randomInt } from 'node:crypto';
import { cliCommand, defineCli, defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { defaultFace, FACES, generateFace, renderFace } from './faces.js';

const threadIdSchema = z.string().regex(/^thr_[a-zA-Z0-9_-]+$/).max(128);
export const faceSchema = z.string().trim().min(1).max(40).refine(
  value => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value),
  'Use a single visible line without control characters.',
);
const generatedSchema = z.object({
  version: z.literal(1), ears: z.tuple([z.string().length(1), z.string().length(1)]),
  eyes: z.string().length(1), mouth: z.string().length(1), blinkOffset: z.number().int().min(0).max(3999),
});
const generatedChoice = z.object({ version: z.literal(1), kind: z.literal('generated') }).strict();
const stateSchema = z.enum(['idle', 'running', 'waiting', 'error']);
const identitySchema = z.object({ threadId: threadIdSchema, face: faceSchema, custom: z.boolean(), generated: generatedSchema.optional() });
const threadInput = z.object({ threadId: threadIdSchema }).strict();
export const rpcContract = defineRpcContract({
  get: { input: threadInput, output: identitySchema },
  getMany: { input: z.object({ threadIds: z.array(threadIdSchema).max(200) }).strict(), output: z.array(identitySchema) },
  set: { input: threadInput.extend({ face: faceSchema }), output: identitySchema },
  shuffle: { input: threadInput, output: identitySchema },
  generate: { input: threadInput, output: identitySchema },
  activity: { input: z.object({ threadIds: z.array(threadIdSchema).max(200) }).strict(),
    output: z.array(z.object({ threadId: threadIdSchema, state: stateSchema })) },
  reset: { input: threadInput, output: identitySchema },
});

export default function plugin(bb: BbPluginApi) {
  bb.settings.define({
    showActivity: { type: 'boolean', label: 'Show activity expressions', default: false },
    showHeader: { type: 'boolean', label: 'Show face in thread header', default: true },
    showSidebar: { type: 'boolean', label: 'Show faces in sidebar', default: false },
    useThemeColor: { type: 'boolean', label: 'Use theme color', default: false },
    animation: { type: 'select', label: 'Animation style', options: ['off', 'subtle', 'playful'], default: 'subtle' },
  });
  const key = (threadId: string) => `thread:${threadId}`;
  async function get(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    const value = await bb.storage.kv.get(key(threadId));
    if (generatedChoice.safeParse(value).success) {
      const generated = generateFace(threadId, thread.parentThreadId);
      return { threadId, face: renderFace(generated), custom: true, generated };
    }
    const stored = faceSchema.safeParse(value);
    return { threadId, face: stored.success ? stored.data : defaultFace(threadId), custom: stored.success };
  }
  async function set(threadId: string, value: string) {
    await bb.sdk.threads.get({ threadId });
    const face = faceSchema.parse(value);
    await bb.storage.kv.set(key(threadId), face);
    bb.realtime.publish('changed', { threadId });
    return { threadId, face, custom: true };
  }
  async function reset(threadId: string) {
    await bb.sdk.threads.get({ threadId });
    await bb.storage.kv.delete(key(threadId));
    bb.realtime.publish('changed', { threadId });
    return { threadId, face: defaultFace(threadId), custom: false };
  }
  async function shuffle(threadId: string) {
    const current = await get(threadId);
    const choices = FACES.filter(item => item.face !== current.face);
    return set(threadId, choices[randomInt(choices.length)]!.face);
  }
  async function generate(threadId: string) {
    await bb.sdk.threads.get({ threadId });
    await bb.storage.kv.set(key(threadId), { version: 1, kind: 'generated' });
    bb.realtime.publish('changed', { threadId });
    return get(threadId);
  }
  // Read authoritative state instead of retaining ephemeral activity across reloads.
  async function activity(threadId: string) {
    const [thread, interactions] = await Promise.all([
      bb.sdk.threads.get({ threadId }), bb.sdk.threads.interactions.list({ threadId }),
    ]);
    const state = interactions.some(interaction => interaction.status === 'pending') ? 'waiting'
      : thread.status === 'error' ? 'error'
      : ['active', 'starting', 'stopping'].includes(thread.status) ? 'running' : 'idle';
    return { threadId, state: stateSchema.parse(state) };
  }
  for (const event of ['thread.active', 'thread.idle', 'thread.failed', 'interaction.pending', 'experimental_thread.events'] as const) {
    bb.events.on(event, ({ thread }) => bb.realtime.publish('activity', { threadId: thread.id }));
  }
  bb.rpc.register(rpcContract, {
    generate: ({ threadId }) => generate(threadId),
    activity: async ({ threadIds }) => {
      const results = await Promise.allSettled([...new Set(threadIds)].map(activity));
      return results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    },
    get: ({ threadId }) => get(threadId),
    getMany: async ({ threadIds }) => {
      const results = await Promise.allSettled([...new Set(threadIds)].map(get));
      return results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    },
    set: ({ threadId, face }) => set(threadId, face),
    shuffle: ({ threadId }) => shuffle(threadId),
    reset: ({ threadId }) => reset(threadId),
  });
  bb.events.on('thread.deleted', async ({ thread }) => {
    await bb.storage.kv.delete(key(thread.id));
  });
  const options = {
    thread: { type: 'string', description: 'Thread id; defaults to the current thread' },
    json: { type: 'boolean', description: 'Emit JSON' },
  } as const;
  const target = (value: string | undefined, current: string | undefined) => threadIdSchema.parse(value ?? current);
  const reply = (value: Awaited<ReturnType<typeof get>>, json: boolean | undefined) => ({
    exitCode: 0, stdout: json ? JSON.stringify(value) : `${value.face}  ${value.threadId}`,
  });
  bb.cli.register(defineCli({
    name: 'asciimoji', summary: 'Personalize threads with a persistent asciimoji',
    commands: {
      get: cliCommand({ summary: 'Show a thread’s face', options, async run(input, ctx) {
        return reply(await get(target(input.options.thread, ctx.threadId)), input.options.json);
      } }),
      set: cliCommand({ summary: 'Save a custom face', options,
        positionals: [{ name: 'face', description: 'Quoted asciimoji', required: true }],
        async run(input, ctx) {
          return reply(await set(target(input.options.thread, ctx.threadId), input.positionals.face), input.options.json);
        } }),
      shuffle: cliCommand({ summary: 'Choose a different preset', options, async run(input, ctx) {
        return reply(await shuffle(target(input.options.thread, ctx.threadId)), input.options.json);
      } }),
      generate: cliCommand({ summary: 'Save a deterministic generated face', options, async run(input, ctx) {
        return reply(await generate(target(input.options.thread, ctx.threadId)), input.options.json);
      } }),
      reset: cliCommand({ summary: 'Restore the automatic face', options, async run(input, ctx) {
        return reply(await reset(target(input.options.thread, ctx.threadId)), input.options.json);
      } }),
    },
  }));
}
