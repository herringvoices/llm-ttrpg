# Third-party runtime notices

The Windows desktop distribution downloads or bundles the following third-party components:

- **llama.cpp**, pinned to build `b11398`, is bundled as the Windows CPU runtime. It is distributed under the MIT License. Source and license: <https://github.com/ggml-org/llama.cpp/tree/b11398>
- **Qwen3-8B-GGUF**, file `Qwen3-8B-Q4_K_M.gguf`, is downloaded on first launch from the official Qwen repository at pinned revision `6a569868d07d3bd59e8b97fb001bf8c0b254bb20`. It is distributed under the Apache License 2.0. Model card and license: <https://huggingface.co/Qwen/Qwen3-8B-GGUF/tree/6a569868d07d3bd59e8b97fb001bf8c0b254bb20>

The build preparation script verifies the llama.cpp archive with SHA-256 `a5b932cb28b2f17da93bf7111c7cbd1324cffa3a6f474aa10b616908868037a2`. The installed model is accepted only after its SHA-256 matches `d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785`.
