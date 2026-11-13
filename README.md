# Clariva

**From Confusion to Confidence.**

Clariva is an educational platform by **Pro Idea** designed to help Nigerian students access curated learning resources and study support in one place.

**Live website:** https://proideacodestudio.github.io/Clariva/  
**Repository:** https://github.com/ProIdeaCodeStudio/Clariva

## What Clariva offers

- **Study resources:** curated academic materials and PDF reading.
- **CBT practice:** computer-based test practice tools.
- **AI-assisted learning:** support for understanding academic concepts.
- **Student access:** account-based access to learning resources.
- **Resource administration:** authorised administrators can manage published materials.

Feature availability may evolve as the platform develops.

## Technology

Clariva is built with:
- HTML, CSS and JavaScript
- Supabase for authentication, database and storage services
- PDF.js for in-browser PDF viewing
- GitHub Pages for static website hosting

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html` | Public landing page and account entry |
| `Undergraduates.html` | Student resource library |
| `AdminDashboard.html` | Administrative interface |
| `reset-password.html` | Password reset interface |
| `script.js` | Shared application and authentication logic |
| `StudentResources.js` | Student resource-library behaviour |
| `AdminDashboard.js` | Administrative dashboard behaviour |
| `ProfileMenu.js` / `ProfileMenu.css` | Shared account menu |
| `Stylesheet.css` | Main site styles |
| `supabase/migrations/` | Database migration history |

## Deployment

The public site is deployed with GitHub Pages from the repository's `main` branch.

Live URL: https://proideacodestudio.github.io/Clariva/

Changes should be developed on a feature branch, reviewed through a pull request, and merged only after verification. Do not commit unreviewed changes directly to the production branch.

## Development notes

1. Clone the repository.
2. Open the project folder in a code editor.
3. Serve the static files using a local development server.
4. Use the configured Supabase project for authentication and backend features.

The browser application uses a Supabase publishable key. Publishable keys are designed for client-side use; they are **not** a substitute for database security. Row Level Security (RLS), storage policies and least-privilege grants must enforce access on the backend.

Never commit Supabase secret/service-role keys, passwords, private tokens, user data exports, or environment files containing secrets. If a secret is ever exposed, rotate it immediately and review access logs.

## Security

Please report suspected vulnerabilities privately to **Pro Idea** at [Proidea2025@gmail.com](mailto:Proidea2025@gmail.com). Do not publish sensitive vulnerability details in a public issue.

See [SECURITY.md](SECURITY.md) for the security reporting policy.

## Ownership and permitted use

Clariva's original source code, visual identity, graphics, written content and other original project materials are proprietary to their respective rights holders. Unless a separate written permission or third-party licence applies, no permission is granted to reproduce, redistribute, modify, publish, or commercially exploit those materials.

See [LICENSE](LICENSE). Third-party libraries and services remain subject to their own licences and terms.

---

**Clariva** is a product developed by **Pro Idea**.  
Copyright © 2026 Pro Idea. All rights reserved.
