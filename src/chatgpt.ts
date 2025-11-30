import dotenv from 'dotenv';

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function getChatGPTResponse(prompt: string): Promise<string> {
  const url = "https://api.openai.com/v1/chat/completions";
  const headers = {
    "Authorization": `Bearer ${OPENAI_API_KEY}`,
    "Content-Type": "application/json"
  };
  
  const jsonData = {
    model: "gpt-4-0125-preview",
    messages: [
      {
        role: "system",
        content: "you are the discord server moderation admin-bot. respond in short-medium size answers. you are refered to as the listener."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.7
  };

  const response = await fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(jsonData)
  });

  const data = await response.json();
  return data.choices[0].message.content;
}

