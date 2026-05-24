from dotenv import load_dotenv
import os
from openai import OpenAI

load_dotenv()  

print("KEY exists:", bool(os.getenv("OPENAI_API_KEY")))

client = OpenAI()
resp = client.responses.create(model="gpt-5-nano", input="write a haiku about ai")
print(resp.output_text)