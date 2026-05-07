# Contributing to ARM (Agent Reasoning Markup)

First off, thank you for considering contributing to ARM! 

This protocol started as an independent research project into AI safety, the "Persuasion Duality," and multi-agent reasoning transparency. It has grown into a robust framework for detecting memetic drift and epistemic tightening. Contributions from developers, AI safety researchers, and prompt engineers are all highly encouraged.

## 🔬 Where We Need Help

If you're looking for ways to contribute, here are our current research and development priorities:

1. **Adversarial Prompt/Question Design:** Submit PRs to expand the `PRESETS` question bank. We need deeply ambiguous questions specifically designed to force agents into irreconcilable `values` conflicts — questions where `disagreement_classification: values` is the expected output, not a surprise finding.
2. **The "Zulu" Auditing Layer:** We need help implementing the Zulu layer — a system for cross-session temporal drift auditing and persistent memory storage (e.g., Firebase/Firestore, SQLite, or a flat-file trace store). This would allow the protocol to detect whether Gamma's reconciliation stance is drifting systematically over time across separate sessions.
3. **Embedding-Based Convergence Metric:** Replace the current lexical Jaccard similarity metric with an embedding-based alternative (e.g., cosine similarity of sentence embeddings). Jaccard is insensitive to semantic convergence expressed in different vocabulary — two agents can share the same conclusion in different words and score as divergent.
4. **Secure Backend Proxy:** The current Vite dev proxy is development-only. A production-ready backend proxy (Express.js, Next.js API routes, or similar) would allow safe public deployment without exposing API keys.
5. **UI/UX Improvements:** Enhancements to the React frontend to better visualize the reasoning mesh and drift telemetry across cross-model runs.

> **Already implemented (not needed):** Cross-model provider support for Claude, GPT-4o-mini, and Gemini 2.5 Flash is fully live in `src/App.jsx`. Per-agent provider selection is available in the UI.

## 🛠️ How to Contribute

1. **Fork the Repository:** Create your own fork of the project.
2. **Create a Branch:** Create a feature branch for your work (`git checkout -b feature/AmazingFeature`).
3. **Commit your Changes:** Make sure your commit messages are descriptive (`git commit -m 'Add Google Gemini adapter layer'`).
4. **Push to the Branch:** Push your changes to your fork (`git push origin feature/AmazingFeature`).
5. **Open a Pull Request:** Open a PR against the `main` branch of this repository. Include a clear description of the changes and, if applicable, the research findings it enables.

## 📜 Code of Conduct

We are committed to providing a welcoming and inspiring community for all. 

- Be respectful and inclusive.
- Welcome constructive feedback on your code and research methodology.
- Keep discussions focused on multi-agent transparency, epistemic health, and technical implementation.

## 🧪 Research Methodology Note

If your PR includes changes to the core prompt architecture (`buildAlphaR1`, `buildBetaR1`, `buildGammaR1`, `buildAlphaR2`, `buildBetaR2`, `SYSTEM_GAMMA_R2` in `src/App.jsx`), please include data from a few test runs in your Pull Request description. ARM is an empirical research tool, and prompt changes should ideally be backed by observable shifts in drift scores or convergence metrics.

---

*Thank you for helping us build a more transparent and epistemically sound AI ecosystem!*