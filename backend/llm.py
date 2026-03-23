import sys
import g4f

def main():
    if len(sys.argv) < 2:
        print("I'm sorry, no input provided.")
        return

    query = sys.argv[1]
    prompt = f"You are Persona, a highly intelligent and professional AI agency receptionist. Answer the following user instantly and concisely in exactly 1 or 2 sentences ONLY: {query}"
    
    try:
        response = g4f.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}]
        )
        print(response.strip())
    except Exception as e:
        print("I am currently experiencing higher than normal network latency. Please hold.")

if __name__ == "__main__":
    main()
