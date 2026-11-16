// LEGACY (fallback, Ctrl+F6): the old native GM panel, kept unchanged except for the paths, the key binding and the login hand-over.
// GM helper (client side, GreedyFox). The chat box cannot carry GM commands (it uses its own chat protocol), so these console
// functions send them to the server's GMCommands mod through the same path that works: commandToServer('LocalChatMessage', "!...").
// Console (~) usage:
//   gm("whoami");           gm("help");
//   gm("give 241 50");      gm("give <itemTypeId> [quantity] [quality] [durability]");
//   gm("announce Hello!");
//   gmgive(241, 50);        gmsay("Hello!");
exec("mod/KanzleiMOD/legacy/gmpanel.cs");
