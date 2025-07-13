from dotenv import load_dotenv
import aiohttp
import os
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

async def get_chatgpt_response(prompt: str):
    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }
    json_data = {
        "model": "gpt-4",  # or "gpt-3.5-turbo" for cheaper
        "messages": [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.7
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(url, headers=headers, json=json_data) as resp:
            data = await resp.json()
            return data['choices'][0]['message']['content']