# Security Policy

## Supported deployment

Security reports are welcome for the currently deployed Clariva application.

## Reporting a vulnerability

Please email **Proidea2025@gmail.com** with:
- A concise description of the issue.
- The affected page or feature.
- Steps to reproduce the issue, where safe to do so.
- Any relevant screenshots or non-sensitive evidence.

Please do not include passwords, access tokens, private keys, student records, or other personal information in a report. Do not publicly disclose an unpatched vulnerability.

## Security expectations

- Never commit secret keys, service-role keys, passwords, or private tokens.
- Keep Supabase Row Level Security and Storage policies enabled and restrictive.
- Treat all browser-visible configuration as public.
- Validate authorisation on the backend; hiding a UI control is not an access-control boundary.
