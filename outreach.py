import json
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os
from dotenv import load_dotenv
import time

load_dotenv(dotenv_path='./backend/.env')

def send_pitch(to_email, business_name):
    sender_email = os.getenv('SENDER_EMAIL')
    sender_password = os.getenv('SENDER_PASSWORD') # Gmail App Password
    
    if not sender_email or not sender_password:
        print("⚠️ Error: SENDER_EMAIL or SENDER_PASSWORD not set in backend/.env")
        return False

    subject = f"Quick question about {business_name}'s reception"
    base_url = os.getenv('VITE_API_URL', 'https://personaplex-backend.onrender.com')

    # Professional HTML Pitch
    body = f"""
    <html>
    <body style="font-family: sans-serif; line-height: 1.6; color: #333;">
        <p>Hi there,</p>
        <p>I was looking at <b>{business_name}</b> and noticed you have a great reputation. I built a custom AI Voice Assistant specifically for local businesses like yours to handle missed calls and booking inquiries 24/7.</p>
        <p>I'd love for you to hear what it sounds like. I've set up a live demo for you here:</p>
        <p><a href="{base_url}/index.html" style="background: #3b82f6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Listen to the AI Demo</a></p>
        <p>It takes about 30 seconds to hear it in action. If you like it, we can have it live on your site by tomorrow.</p>
        <p>Best regards,<br><b>The ChatVora Team</b></p>
    </body>
    </html>
    """

    msg = MIMEMultipart()
    msg['From'] = f"ChatVora AI <{sender_email}>"
    msg['To'] = to_email
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'html'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(sender_email, sender_password)
        server.send_message(msg)
        server.quit()
        return True
    except Exception as e:
        print(f"❌ Failed to send to {to_email}: {e}")
        return False

def run_outreach():
    try:
        with open('leads.json', 'r') as f:
            leads = json.load(f)
    except FileNotFoundError:
        print("⚠️ leads.json not found. Run lead_scraper.py first!")
        return

    print(f"🚀 Starting automated outreach for {len(leads)} leads...")
    
    success_count = 0
    for lead in leads:
        print(f"📧 Sending pitch to {lead['name']} ({lead['email']})...")
        if send_pitch(lead['email'], lead['name']):
            print(f"✅ Success!")
            success_count += 1
        else:
            print(f"⏭️ Skipping...")
        time.sleep(2) # Avoid spam filters

    print(f"\n✨ Outreach Complete! {success_count}/{len(leads)} emails sent.")

if __name__ == "__main__":
    run_outreach()
