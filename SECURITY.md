# Security Policy

## Supported Versions

Currently, the `main` branch of ARM is the only supported version for security updates.

## 🔑 API Key Safety (Crucial)

**ARM is currently architected as a client-side React prototype for research purposes.**

Because of this architecture, API calls to LLM providers (Anthropic, Gemini, etc.) are made directly from the browser. 

- **NEVER commit your `.env` file or hardcode your API keys into the source code.**
- If you fork or deploy this application to the public web (e.g., Vercel, Netlify, GitHub Pages), **your API keys will be exposed to the public frontend**. 
- Do not host this application publicly without first refactoring the API calls to a secure backend proxy (e.g., an Express.js server, Next.js API routes, or Firebase Cloud Functions).

Please use strict budget limits and usage caps on your LLM provider console while developing locally.

## Reporting a Vulnerability

If you discover a security vulnerability within ARM, please do not disclose it publicly.

Instead, please report it via email to: **[Your Email Address Here]**

Please include:
- A description of the vulnerability.
- Steps to reproduce the issue.
- Any potential mitigation strategies if you have them.