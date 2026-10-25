export const sceneInput = { type: 'object', properties: {
  name: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,70}$' },
  width: { type: 'integer', default: 1920 }, height: { type: 'integer', default: 1080 },
  fps: { type: 'integer', minimum: 1, maximum: 60, default: 30 }, seed: { type: 'integer', default: 1 },
  typingSound: { type: 'boolean', description: 'Override the editor keyboard click sound setting for this movie.' },
  typingSoundVolume: { type: 'number', minimum: 0, maximum: 1 },
  audioPath: { type: 'string', description: 'Optional existing audio file mixed after capture. System audio is not captured.' },
  actions: { type: 'array', maxItems: 200, items: { type: 'object', properties: {
    action: { type: 'string', enum: ['open','type','wait','move','select','scroll'] },
    filename: { type: 'string' }, language: { type: 'string' }, text: { type: 'string' },
    delayMs: { type: 'number' }, durationMs: { type: 'integer' }, line: { type: 'integer', minimum: 1 },
    column: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, lines: { type: 'integer' }
  }, required: ['action'] } }
}, required: ['actions'] };
