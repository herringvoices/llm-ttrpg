# Third-party runtime notices

The Windows desktop distribution downloads or bundles the following third-party components:

- **llama.cpp**, pinned to build `b11398`, is bundled as the Windows CPU runtime. It is distributed under the MIT License. Source and license: <https://github.com/ggml-org/llama.cpp/tree/b11398>
- **Qwen3.5-9B-GGUF**, file `Qwen3.5-9B-Q4_K_M.gguf`, is downloaded on first launch from Unsloth's Qwen3.5 9B GGUF conversion at pinned revision `3885219b6810b007914f3a7950a8d1b469d598a5`. The upstream Qwen3.5 9B model is distributed under the Apache License 2.0. Model card and license: <https://huggingface.co/Qwen/Qwen3.5-9B>; conversion source: <https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/tree/3885219b6810b007914f3a7950a8d1b469d598a5>

The build preparation script verifies the llama.cpp archive with SHA-256 `a5b932cb28b2f17da93bf7111c7cbd1324cffa3a6f474aa10b616908868037a2`. The installed model is accepted only after its SHA-256 matches `03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8`.
