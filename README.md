# daily-movie-game
Daily Movie Game
#The goal of this game is to create a website that is similar to the popular game Krillion. The premise of our game however is to quiz the users on movies that we pull from an api. Each day, the game will provide 3 new movies, prompting the user to answer 3 questions: Name the most niche actor possible in the movie, guess the release year of the movie, and what the imdb score is. The user will be rewarded points based on how niche the actor is, how close they are to the actual release, and then proximity to the correct score. At the end, the user will receive a final score, and we want to be able to compare them to all the other users that played the game on the day. Our goal is to pull new movies each day from an API, however the movies need to be somewhat relevant or known. 
https://nnewkirk37.github.io/daily-movie-game/

## How it works

- `index.html`, `style.css`, `js/` — the game. Scoring rules live in `js/scoring.js` (character 150 by billing order, release year 75 minus 5 per year off, IMDb score 75 minus 5 per 0.2 off).
- `scripts/build-days.mjs` — pulls 3 well-known movies per day from TMDB, with the IMDb rating from OMDb, and writes `data/days/YYYY-MM-DD.json`.
- `.github/workflows/daily-movies.yml` — runs that script every night (keeps 7 days ready) and deploys the site to GitHub Pages. Also redeploys on every push to `main`.
- `supabase/schema.sql` — the leaderboard table and its security rules. Run once in the Supabase SQL Editor.

Repository secrets needed: `TMDB_API_KEY`, `OMDB_API_KEY`.

Practice any built day without touching the leaderboard: `?date=YYYY-MM-DD`.
