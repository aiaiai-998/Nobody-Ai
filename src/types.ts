export type MessageRole = 'user' | 'assistant' | 'system';

/** A file the user attached to a message. */
export interface Attachment {
  id: string;
  kind: 'image' | 'document';
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** `data:` URL, for images sent to a vision model. */
  dataUrl?: string;
  /** Extracted plain text, for documents such as PDFs. */
  text?: string;
  /** Set when extraction failed, so the UI can explain instead of sending nothing. */
  error?: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  model?: string;
  error?: boolean;
  attachments?: Attachment[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  systemPersonaId: string;
  modelId: string;
}

/** Which upstream service actually runs the inference. */
export type ModelProvider = 'Auto' | 'OpenRouter' | 'Groq' | 'Offline demo';

export interface AIModel {
  /**
   * Stable app-level identifier. The provider prefix is significant:
   *   `openrouter/<slug>`  -> routed to the OpenRouter chat-completions endpoint
   *   `groq/<slug>`        -> routed to the Groq chat-completions endpoint
   *   `offline/<name>`     -> handled locally by the scripted demo engine
   * Everything after the first `/` is forwarded verbatim as the upstream model slug.
   */
  id: string;
  name: string;
  provider: ModelProvider;
  description: string;
  badge: string;
  isFreeByDefault: boolean;
  requiresKey: boolean;
  speed: 'Ultra Fast' | 'Fast' | 'Moderate';
  /** True when the model accepts `image_url` content parts. */
  supportsImages?: boolean;
  /** Set on entries discovered from a provider's live catalog rather than curated here. */
  fromLiveCatalog?: boolean;
}

export interface SystemPersona {
  id: string;
  name: string;
  icon: string;
  description: string;
  systemPrompt: string;
}

export interface AppSettings {
  activeModelId: string;
  activePersonaId: string;
  openRouterApiKey: string;
  groqApiKey: string;
  temperature: number;
  maxTokens: number;
  autoSpeech: boolean;
}
