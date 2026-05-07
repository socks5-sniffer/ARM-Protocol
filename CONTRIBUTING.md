# Contributing to ARM (Agent Reasoning Markup)

First off, thank you for considering contributing to ARM! 

This protocol started as an independent research project into AI safety, the "Persuasion Duality," and multi-agent reasoning transparency. It has grown into a robust framework for detecting memetic drift and epistemic tightening. Contributions from developers, AI safety researchers, and prompt engineers are all highly encouraged.

## 🔬 Where We Need Help

If you're looking for ways to contribute, here are our current research and development priorities:

1. **Cross-Model Integration:** Currently, ARM heavily utilizes Claude (Anthropic). We need help building robust adapter layers to seamlessly integrate OpenAI (GPT) and Google (Gemini) models. True cross-model deliberation is the key to bypassing shared RLHF priors and testing for `values`-level disagreements.
2. **The "Zulu" Auditing Layer:** We need help implementing the "Zulu" layer—a system for cross-session temporal drift auditing and persistent memory storage (e.g., integrating Firebase/Firestore or SQLite).
3. **Adversarial Prompt/Question Design:** Submit PRs to expand our `PRESETS` question bank. We need deeply ambiguous questions specifically designed to force agents into irreconcilable `values` conflicts.
4. **UI/UX Improvements:** Enhancements to the React frontend to better visualize the "reasoning mesh" and drift telemetry.

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

If your PR includes changes to the core Prompt Architecture (`SYSTEM_R1`, `SYSTEM_R2`, `SYSTEM_GAMMA_R2`), please include data from a few test runs in your Pull Request description. ARM is an empirical research tool, and prompt changes should ideally be backed by observable shifts in drift scores or convergence metrics.

---

*Thank you for helping us build a more transparent and epistemically sound AI ecosystem!*