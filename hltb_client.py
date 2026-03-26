from howlongtobeatpy import HowLongToBeat
import re
import json
import os

BASE_DIR = os.path.dirname(__file__)
CACHE_FILE = os.path.join(BASE_DIR, 'game_cache.json')


class HLTBClient:
    def __init__(self):
        self.hltb = HowLongToBeat()
        self.persist_cache = self._should_persist_cache()
        self.cache = self.load_cache()

    def load_cache(self):
        if os.path.exists(CACHE_FILE):
            try:
                with open(CACHE_FILE, 'r') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                return {}
        return {}

    def save_cache(self):
        if not self.persist_cache:
            return

        try:
            with open(CACHE_FILE, 'w') as f:
                json.dump(self.cache, f, indent=4)
        except IOError as e:
            print(f"Error saving cache: {e}")

    def get_game_data(self, game_name):
        """
        Searches specific game on HowLongToBeat and returns the most relevant result.
        Returns a dictionary with times or None if not found.
        """
        if game_name in self.cache:
            return self.cache[game_name]

        try:
            results = self.hltb.search(game_name)
            cleaned_name = self._clean_name(game_name)

            if not results:
                if cleaned_name != game_name:
                    results = self.hltb.search(cleaned_name)

            if not results and game_name.isupper():
                title_case_name = game_name.title()
                results = self.hltb.search(title_case_name)

            if not results and cleaned_name.isupper():
                cleaned_title_case_name = cleaned_name.title()
                results = self.hltb.search(cleaned_title_case_name)

            if not results:
                return None

            best_match = max(results, key=lambda element: element.similarity)

            data = {
                'name': best_match.game_name,
                'main_story': best_match.main_story,
                'main_extra': best_match.main_extra,
                'completionist': best_match.completionist,
                'similarity': best_match.similarity,
                'img_url': best_match.game_image_url
            }

            self.cache[game_name] = data
            self.save_cache()

            return data

        except Exception as e:
            print(f"Error fetching HLTB data for '{game_name}': {e}")
            return None

    def _clean_name(self, name):
        name = re.sub(r'[™®]', '', name)
        name = re.sub(r'\b(TM|R)\b', '', name)
        name = re.sub(
            r'\s*(Game of the Year|GOTY|Special|Anniversary|Digital|Deluxe|Gold|Ultimate)\s*Edition',
            '',
            name,
            flags=re.IGNORECASE
        )
        return name.strip()

    def _should_persist_cache(self):
        persist_override = os.getenv('HLTB_PERSIST_CACHE')
        if persist_override is not None:
            return persist_override.strip().lower() in {'1', 'true', 'yes', 'on'}

        return not bool(os.getenv('VERCEL'))
