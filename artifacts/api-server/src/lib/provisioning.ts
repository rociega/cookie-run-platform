export function composeOnstartCommands(
  ...commands: Array<string | null | undefined>
): string {
  return commands
    .filter((command): command is string => Boolean(command))
    .join("\n");
}
