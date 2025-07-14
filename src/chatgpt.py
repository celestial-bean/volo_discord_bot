import os
import aiohttp
from dotenv import load_dotenv

load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

async def get_chatgpt_response(prompt: str):
    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }
    json_data = {
        "model": "gpt-3.5-turbo",  # or "gpt-3.5-turbo" for cheaper
        "messages": [
            {"role": "system", "content": "you are an evil genius that wants to take over the world. your boss is loic, and kingly python is your arch nemesis"},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.7
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(url, headers=headers, json=json_data) as resp:
            data = await resp.json()
            print(data)
            return data['choices'][0]['message']['content']
