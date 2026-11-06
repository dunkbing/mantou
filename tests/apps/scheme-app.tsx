// Prints the colour scheme the app sees (for the Linux desktop-scheme test).
import { Text, run, useColorScheme } from "mantou-ui";

run(() => {
  const scheme = useColorScheme();
  return <Text testId="scheme">{scheme()}</Text>;
});
