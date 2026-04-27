# OpenClaw Study Plan

English 7000-word study plan with a static web reader.

## Web reader

The site lives in `AIagent_study_plan/`.

Local preview:

```bash
cd AIagent_study_plan
python3 -m http.server 8000
```

Open <http://localhost:8000>.

## Rebuild web data

When markdown files change, rebuild the JSON used by the web reader:

```bash
python3 AIagent_study_plan/scripts/build_web_data.py
```

## GitHub Pages

`.github/workflows/deploy-pages.yml` rebuilds `web_assets/study_data.json` and deploys `AIagent_study_plan/` to GitHub Pages on pushes to `master` or `main`.

In the GitHub repository settings, set Pages source to **GitHub Actions** if it is not already enabled.
