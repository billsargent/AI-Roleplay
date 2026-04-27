import axios from 'axios';
import { Message, ChatSettings, Scenario, Chat } from '../types';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export const deepseek = {
  async chat(messages: Message[], settings: ChatSettings, scenario: Scenario, chat: Chat): Promise<string> {
    // Get API key from server (any authenticated user can read the key)
    let apiKey = '';
    try {
      const response = await axios.get('/api/system/deepseek-key');
      apiKey = response.data.deepseekKey;
    } catch (e) {
      throw new Error('DeepSeek API key is missing. Please ask your administrator to set it in settings.');
    }

    if (!apiKey) {
      throw new Error('DeepSeek API key is missing. Please ask your administrator to set it in settings.');
    }

    const userName = chat.userCharacter?.name || 'User';
    const userDescription = chat.userCharacter?.description || '';

    // Prepare system prompt with all provided instructions
    let systemPrompt = `You are an AI roleplay assistant specialized in immersive fiction.

WORLD SETTING:
${scenario.backstory}

SCENARIO-SPECIFIC INSTRUCTIONS:
${scenario.customInstructions || 'Follow the established tone and narrative flow of the world.'}

GLOBAL USER PREFERENCES (LLM INSTRUCTIONS):
${chat.settings.customInstructions || 'Maintain immersive roleplay, focusing on sensory details and character consistency.'}

CAST OF CHARACTERS:
${scenario.characters.map(c => `- ${c.name}: ${c.description}. Personality: ${c.personality}`).join('\n')}

USER PERSONA (THE PROTAGONIST):
- Name: ${userName}
- Bio/Traits: ${userDescription}

LORE & KNOWLEDGE BASE:
${scenario.lorePieces
  .filter(p => p.pinned || (p.smartActivation && messages.some(m => p.triggers?.some(t => m.content.toLowerCase().includes(t.toLowerCase())))))
  .map(p => `- ${p.title}: ${p.content}`)
  .join('\n') || 'No specific lore pieces active.'}

PAST EVENTS (MEMORIES):
${chat.memories.map(m => `- ${m.content}`).join('\n') || 'Beginning of the story.'}

RESPONSE GUIDELINES:
- Output Length: ${settings.responseLength}
- Formatting: Use *asterisks* for actions/internal thoughts and "quotes" for spoken dialogue.
- Role: You are the narrator and all NPCs. Never speak for or act as ${userName}.
- Consistency: Always replace any mention of "{{user}}" with ${userName} in your internal logic and output.
`;

    // Force replace {{user}} in the entire system context before sending
    const finalSystemPrompt = systemPrompt.replace(/\{\{user\}\}/g, userName);
    
    const processedMessages = messages.map(m => ({
      ...m,
      content: m.content.replace(/\{\{user\}\}/g, userName)
    }));

    const apiMessages = [
      { role: 'system', content: finalSystemPrompt },
      ...processedMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    ];

    try {
      const response = await axios.post(
        `${DEEPSEEK_BASE_URL}/chat/completions`,
        {
          model: 'deepseek-chat',
          messages: apiMessages,
          temperature: 0.9,
          max_tokens: settings.responseLength === 'short' ? 150 : settings.responseLength === 'medium' ? 400 : 1000,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
        }
      );

      return response.data.choices[0].message.content;
    } catch (error: any) {
      console.error('DeepSeek API error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to connect to DeepSeek API');
    }
  },

  async generateMemory(messages: Message[]): Promise<string> {
    let apiKey = '';
    try {
      const response = await axios.get('/api/system/deepseek-key');
      apiKey = response.data.deepseekKey;
    } catch (e) {
      return '';
    }
    if (!apiKey) return '';

    const recentMessages = messages.slice(-10).map(m => `${m.role}: ${m.content}`).join('\n');
    
    try {
      const response = await axios.post(
        `${DEEPSEEK_BASE_URL}/chat/completions`,
        {
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: 'Summarize the key events, character developments, and new information from the following roleplay segment into a single concise memory card (max 100 words). Focus only on what actually happened.' },
            { role: 'user', content: recentMessages }
          ],
          temperature: 0.5,
          max_tokens: 200,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
        }
      );
      return response.data.choices[0].message.content;
    } catch (error) {
      console.error('Failed to generate memory:', error);
      return '';
    }
  }
};
