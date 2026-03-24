import requests
from bs4 import BeautifulSoup
import re
import json

def scrape_leads(industry, location):
    print(f"🔍 Searching for {industry} in {location}...")
    
    # Simple Google Search or Yellow Pages scraper (Mock logic for local demo)
    # In a real production scenario, you'd use a Google Maps API or a specialized scraper.
    
    leads = [
        {"name": "Elite Dental Care", "website": "https://example-dentist.com", "email": "contact@example-dental.com"},
        {"name": "Precision HVAC Services", "website": "https://precision-hvac.com", "email": "info@precision-hvac.com"},
        {"name": "Oak & Iron Law Firm", "website": "https://oilaw.com", "email": "hello@oilaw.com"},
    ]
    
    # Save to JSON
    with open('leads.json', 'w') as f:
        json.dump(leads, f, indent=4)
        
    print(f"✅ Found {len(leads)} potential leads. Saved to leads.json")
    print("Next Step: Send your professional AI demo link to these emails!")

if __name__ == "__main__":
    # Industry and location can be customized by the user
    scrape_leads("Dentists", "London")
