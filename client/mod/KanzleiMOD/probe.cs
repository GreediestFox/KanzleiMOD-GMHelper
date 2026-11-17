// KanzleiMOD - PROBE: checks, on YOUR client, the things that could not be tested outside the game. Run it once from the console (~):
//        KZProbe();
// It prints "[KZProbe] ..." lines to the console / log and opens the browser feature page.  Send the lines (and a screenshot of the page) back.
// Nothing here changes anything: it only reads, and sends a few harmless test requests to the relay.

function KZProbe()
{
   echo("[KZProbe] ---- start, KanzleiMOD" SPC $KZ::version);
   echo("[KZProbe] openWeb:" SPC (isFunction("openWeb") ? "yes" : "NO - the web UI cannot open, Ctrl+F6 stays the fallback"));
   %h = new SimDownloadHelper();
   echo("[KZProbe] SimDownloadHelper:" SPC (isObject(%h) ? "yes" : "NO"));
   if (isObject(%h)) { %h.delete(); }
   echo("[KZProbe] Canvas:" SPC Canvas.getExtent() SPC " PlayGui:" SPC (isObject(PlayGui) ? PlayGui.getClassName() : "none"));
   if (isObject($KZ::web)) {
      echo("[KZProbe] web window (open now): class" SPC $KZ::web.getClassName() SPC "group" SPC (isObject($KZ::web.getGroup()) ? $KZ::web.getGroup().getClassName() SPC $KZ::web.getGroup().getName() : "none") SPC "position" SPC $KZ::web.position SPC "extent" SPC $KZ::web.extent SPC "canMove" SPC $KZ::web.canMove SPC "profile" SPC $KZ::web.profile);
   } else {
      echo("[KZProbe] web window: not open - open it with F6 first, then run KZProbe() again to see how the engine made it");
   }
   echo("[KZProbe] doSlashCommand:" SPC (isFunction("doSlashCommand") ? "yes" : "NO"));
   echo("[KZProbe] shellExecute:" SPC (isFunction("shellExecute") ? "yes" : "no (economy dashboard cannot open)"));
   echo("[KZProbe] PlayGui (GOD overlay parent):" SPC (isObject(PlayGui) ? "yes" : "no - the overlay falls back to the canvas content"));
   echo("[KZProbe] strpos is case sensitive:" SPC (strpos("aA", "A") == 1 ? "yes (good)" : "NO - KZ_enc would be wrong"));
   echo("[KZProbe] byte table: A=" @ (strpos($KZ::asc, "A") + 1) SPC "(want 65)  a=" @ (strpos($KZ::asc, "a") + 1) SPC "(want 97)");
   %u = "\xC3\xA4";
   echo("[KZProbe] UTF-8 bytes of an umlaut (a-umlaut as C3 A4): strlen =" SPC strlen(%u) SPC "(2 = bytes are kept, good)  encoded =" SPC KZ_enc(%u) SPC "(want %C3%A4)");
   echo("[KZProbe] language:" SPC KZB_lang() SPC " data files: objects_types.xml" SPC (isFile("data/objects_types.xml") ? "found" : "MISSING") @ ", cm_objects.xml" SPC (isFile("data/cm_objects.xml") ? "found" : "MISSING") @ ", names" SPC (isFile("data/loc/" @ KZB_lang() @ "/data/objects_types_Name.xml") ? "found" : "MISSING"));
   echo("[KZProbe] relay:" SPC $KZ::gameHost);
   // URL length limit of the engine downloader: the relay answers with the length it received
   $KZ::probeSession = 1;
   KZ_req(1, "/api/echo", "d=" @ KZ_enc("\xC3\xA4\xC3\xB6\xC3\xBC"), "KZProbe_echo", "umlauts (want TXT = a-umlaut o-umlaut u-umlaut)");
   %lens = "100 300 600 1000 1800 3000";
   for (%i = 0; %i < getWordCount(%lens); %i++) {
      %n = getWord(%lens, %i);
      %d = "";
      for (%j = 0; %j < %n; %j++) { %d = %d @ "x"; }
      KZ_req(1, "/api/echo", "d=" @ %d, "KZProbe_echo", "url length with" SPC %n SPC "data characters");
   }
   %url = $KZ::pageHost @ "/probe.html?img=" @ KZ_enc(KZ_iconBase() @ "Objects/big_tanning_tub.png");
   if (isFunction("openWeb")) { openWeb(%url); }
   echo("[KZProbe] opened" SPC %url SPC "(browser features). The relay answers follow below.");
}

function KZProbe_echo(%txt, %what)
{
   %line = getRecord(%txt, 0);
   echo("[KZProbe]" SPC %what @ ":" SPC (%txt $= "" ? "NO ANSWER (url too long or relay unreachable)" : %line));
}
