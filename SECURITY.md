# Security

Please do not report security problems in public issues. Report them privately to the maintainers through the
repository host's private vulnerability reporting, or to XGRIDS through the contact on https://www.xgrids.com.
We aim to answer within 5 working days.

Scope notes:
- `npm run dev` is a development server. It listens on 127.0.0.1 by default and never serves hidden files.
  `--host 0.0.0.0` exposes the repository's files to your network; use it only on networks you trust.
- `npm run build` output is static files. The LCC Web SDK inside it is distributed under XGRIDS terms, which allow redistribution inside games.
