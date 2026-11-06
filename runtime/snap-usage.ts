// `mantou snap`'s usage, apart from the command (which loads the JSX compiler) so `mantou --help` stays light.
export const SNAP_USAGE = `mantou snap <entry.tsx> [options]      run the app headless and report what's on screen
  --out shot.png            a screenshot (at --scale, default 2)
  --tree tree.json|tree.txt the tree as drawn: testIds, text, boxes, opacity, roles (.json, or text otherwise)
  --scene NAME              first apply the entry's \`scenes[NAME]\` (--list-scenes lists them)
  --script steps.json       then run steps: [{"press":"save"}, {"press":"row-3","mods":{"shift":true}}, {"type":"hi","into":"name"}, {"key":"Enter"},
                            {"hover":"row"}, {"scroll":"list","dy":300}, {"wait":250}, {"resize":[800,600]},
                            {"snap":"mid.png"}, {"tree":"mid.txt"}]; targets are testIds or [x, y]
  --at MS                   then advance the clock MS (mid-animation; default: until animations settle, up to 2 s)
  --strip sheet.png         then a contact sheet: --frames N (12) --every MS (33) --cols N (4)
  --check-motion [MS]       then watch MS (1000) of motion after the script; exit 1 on jumps, flicker or
                            animations that never settle (--allow id,id for spinners)
  --size 800x600 --scale 2  the window's logical size (default: run()'s width and height, else 800×600)
  --dark | --light          the system colour scheme;  --reduced-motion
  --quiet                   don't print the tree
Exits 1 with a message when a step's target isn't there (naming the testIds that are).`;
