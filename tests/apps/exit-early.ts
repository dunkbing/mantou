// An app that quits before it shows anything (as a second launch does after handing off to the first).
process.exit(Number(process.env.EXIT_CODE ?? 0));
