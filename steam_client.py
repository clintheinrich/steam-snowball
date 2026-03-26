import requests
import json
import os

STEAM_API_BASE = "https://api.steampowered.com"
session = requests.Session()

# Load config if it exists
CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'config.json')
try:
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, 'r') as f:
            config = json.load(f)
            
            # Load cookies if present
            if 'cookies' in config and config['cookies']:
                # Filter out empty cookie values
                cookies_to_add = {k: v for k, v in config['cookies'].items() if v}
                if cookies_to_add:
                    session.cookies.update(cookies_to_add)
                    print("Loaded cookies from config.json")
except Exception as e:
    print(f"Warning: Failed to load config.json: {e}")

# Add browser-like headers to the session
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
})

def get_steam_id(api_key, identifier):
    """
    Resolves a Steam ID from a vanity URL name or checks if it's already a 64-bit ID.
    """
    if identifier.isdigit() and len(identifier) == 17:
        return identifier
    
    url = f"{STEAM_API_BASE}/ISteamUser/ResolveVanityURL/v0001/"
    params = {
        'key': api_key,
        'vanityurl': identifier
    }
    try:
        response = session.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        if data['response']['success'] == 1:
            return data['response']['steamid']
        else:
            return None
    except requests.RequestException as e:
        print(f"Error resolving vanity URL: {e}")
        return None

def get_owned_games(api_key, steam_id):
    """
    Fetches the list of owned games for a given Steam ID.
    Returns a list of dictionaries containing appid, name, playtime_forever, etc.
    """
    url = f"{STEAM_API_BASE}/IPlayerService/GetOwnedGames/v0001/"
    params = {
        'key': api_key,
        'steamid': steam_id,
        'include_appinfo': 'true',
        'include_played_free_games': 'true',
        'format': 'json'
    }
    
    try:
        response = session.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        
        # Check if the 'games' key exists (it might not if the games list is empty or hidden)
        if 'response' in data and 'games' in data['response']:
            return data['response']['games']
        elif 'response' in data and not data['response']:
             # Empty response often means private profile
             print("Empty response. Profile might be private.")
             return None
        else:
            return []
            
    except requests.RequestException as e:
        print(f"Error fetching owned games: {e}")
        return None


