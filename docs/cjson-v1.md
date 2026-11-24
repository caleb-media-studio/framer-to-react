# CJSON/1

Experimental, project-owned open interchange specification. Not JSONC (JSON with comments), an IETF standard, or Framer's private format.

CJSON encodes JSON values without changing their meaning. Original code and binary assets remain separate and unchanged. The two UTF-8 JSON members are **design.cjson** (encoded documents) and **design.cjsonref** (shared dictionary). Both are required. They normally reside inside a standard ZIP archive; the ZIP compression is independent of this encoding.

## Dictionary

The reference member contains format "framer-to-react/cjsonref-v1" and three arrays:

- keys: unique strings.
- shapes: ordered arrays of zero-based key indexes. Each shape has distinct keys.
- strings: unique interned string values.

The data member contains format "framer-to-react/cjson-v1", referenceSha256 (lowercase hexadecimal SHA-256 of the exact UTF-8 reference bytes) and documents (an array of pairs [path, encodedValue]). Paths must be unique, relative, forward-slash separated and free of empty, dot, parent or control-character segments.

## Encoding

| Encoded JSON | Decoded value |
|---|---|
| null, true, false, number, string | Literal |
| [-1, ...values] | Array |
| [-2, stringIndex] | Interned string |
| [-3] | Negative zero |
| [shapeIndex, ...values] | Object with the referenced ordered keys |

Indexes are nonnegative integers. Object values must match the shape's arity. Unsupported tags, invalid indexes, duplicate keys, paths and malformed versions must be rejected. For example, with keys ["name","weight"] and shapes [[0,1]], the object {"name":"Alpha","weight":600} becomes [0,"Alpha",600].

The encoder sorts document paths, assigns keys/shapes on first encounter and selects repeated strings ordered by descending frequency then UTF-16 code unit order. Any valid dictionary ordering may be decoded. See the machine-readable schemas in schemas/.

## Losslessness and safety

JSON values, Unicode, array order, object members and negative zero are preserved. JSON indentation, escape spelling, numeric spelling and duplicate input member occurrences are not preserved; documents use normal JSON parsing semantics. Numbers must be finite and integer values must be safe JavaScript integers. Decoders must handle keys such as __proto__ as data, not prototype operations. The SHA-256 digest binds the dictionary, not the sender's identity.

Implementation limits: nesting 128; 20 million values; one million entries per dictionary; 512 MiB per CJSON member and decoded string/document budgets; 768 MiB ZIP expansion. Exceeding limits is an error. The compiler never mutates the input; the CLI hashes source bytes before processing and again before publishing output.

## CLI

    bun bin/framer-to-react.ts pack source.zip --out compressed.zip
    bun bin/framer-to-react.ts unpack compressed.zip --out decoded-source
    bun bin/framer-to-react.ts compile compressed.zip --out react-app

The compiler also accepts design.cjson alongside its reference and assets in the same extracted directory. Node.js 22.18+ supports the same commands. The output must be a new path outside the input.

During capture, encoding and ZIP compression run in a separate browser worker. Benchmark identical archive members at the same ZIP level with scripts/benchmark-cjson.ts. Compression does not improve visual fidelity.
