# Ink Bird

A Flappy Bird clone where you play as a little ink-spattered bird with a pen-nib
beak. Flap between pipes and scoop up ink droplets floating in each gap.

## Play

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Controls

- **Space / ArrowUp / Click / Tap** — flap
- **R** — restart

## Scoring

- +1 per pipe cleared
- +1 ink per droplet collected (worth 2x in the total / best score)

No build step, no dependencies — just HTML, CSS, and a single JS file.
