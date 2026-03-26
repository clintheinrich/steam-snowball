from flask import Flask, render_template, request, jsonify
from steam_client import get_steam_id, get_owned_games
from hltb_client import HLTBClient
import json
import os

app = Flask(__name__, static_folder='public', static_url_path='')
hltb_client = HLTBClient()


def load_default_steam_api_key():
    env_key = os.getenv('STEAM_API_KEY', '').strip()
    if env_key:
        return env_key

    config_path = os.path.join(os.path.dirname(__file__), 'config.json')
    if not os.path.exists(config_path):
        return ''

    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
    except (OSError, json.JSONDecodeError):
        return ''

    return (config.get('steam_api_key') or '').strip()


DEFAULT_STEAM_API_KEY = load_default_steam_api_key()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/fetch_library', methods=['POST'])
def fetch_library():
    data = request.json
    api_key = (data.get('api_key') or '').strip() or DEFAULT_STEAM_API_KEY
    identifier = data.get('steam_id')
    
    if not api_key or not identifier:
        return jsonify({'error': 'Missing Steam ID or API key. Set STEAM_API_KEY or enter one manually.'}), 400
        
    steam_id = get_steam_id(api_key, identifier)
    if not steam_id:
        return jsonify({'error': 'Could not resolve Steam ID'}), 404
        
    games = []
    errors = []
    
    try:
        owned = get_owned_games(api_key, steam_id)
        if owned:
            for g in owned:
                g['source'] = 'owned'
            games.extend(owned)
        elif owned is None:
            errors.append("Failed to fetch owned games. Check API Key and privacy settings.")
    except Exception as e:
        errors.append(str(e))
    
    if not games and not errors:
        return jsonify({'error': 'No games found.'}), 404
        
    if not games and errors:
        return jsonify({'error': ' | '.join(errors)}), 500
        
    # Sort by playtime (descending) initially, just to have a nice default
    games.sort(key=lambda x: x.get('playtime_forever', 0), reverse=True)
    
    # Pre-fill cached data
    for game in games:
        game_name = game.get('name')
        if game_name and game_name in hltb_client.cache:
            game['hltb'] = hltb_client.cache[game_name]
        else:
             game['hltb'] = None

    return jsonify({'games': games, 'errors': errors})

@app.route('/api/get_game_time', methods=['POST'])
def get_game_time():
    data = request.json
    game_name = data.get('game_name')
    
    if not game_name:
        return jsonify({'error': 'Missing game name'}), 400
        
    hltb_data = hltb_client.get_game_data(game_name)
    
    if hltb_data:
        return jsonify(hltb_data)
    else:
        return jsonify({'error': 'Not found'}), 404

if __name__ == '__main__':
    app.run(debug=True, port=5000)
