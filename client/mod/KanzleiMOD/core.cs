// KanzleiMOD - CORE (client): command execution and data transfer between the game, the server GM mod and the web UI (via the relay).
//
//   web UI --https--> relay <--plain http GET (the engine has no TLS)-- this file
//   - every second the Core asks the relay for commands the web UI queued ("give 241 5 100 100"); it renders them from the command REGISTRY
//     (shared/commands.kz, sent by the server) and runs them: server commands as chat commands, game /slash commands, local actions.
//     The web UI never sends command text, only a command id + values; unknown ids are refused here.
//   - results (green "Erledigt" / red "Fehler"), the player list, GOD state, favourites and the data from the Brain go back the same way.
// Protocol: docs/PROTOCOL.md

$KZ::asc = "\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0A\x0B\x0C\x0D\x0E\x0F\x10"@
   "\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1A\x1B\x1C\x1D\x1E\x1F\x20"@
   "\x21\x22\x23\x24\x25\x26\x27\x28\x29\x2A\x2B\x2C\x2D\x2E\x2F\x30"@
   "\x31\x32\x33\x34\x35\x36\x37\x38\x39\x3A\x3B\x3C\x3D\x3E\x3F\x40"@
   "\x41\x42\x43\x44\x45\x46\x47\x48\x49\x4A\x4B\x4C\x4D\x4E\x4F\x50"@
   "\x51\x52\x53\x54\x55\x56\x57\x58\x59\x5A\x5B\x5C\x5D\x5E\x5F\x60"@
   "\x61\x62\x63\x64\x65\x66\x67\x68\x69\x6A\x6B\x6C\x6D\x6E\x6F\x70"@
   "\x71\x72\x73\x74\x75\x76\x77\x78\x79\x7A\x7B\x7C\x7D\x7E\x7F\x80"@
   "\x81\x82\x83\x84\x85\x86\x87\x88\x89\x8A\x8B\x8C\x8D\x8E\x8F\x90"@
   "\x91\x92\x93\x94\x95\x96\x97\x98\x99\x9A\x9B\x9C\x9D\x9E\x9F\xA0"@
   "\xA1\xA2\xA3\xA4\xA5\xA6\xA7\xA8\xA9\xAA\xAB\xAC\xAD\xAE\xAF\xB0"@
   "\xB1\xB2\xB3\xB4\xB5\xB6\xB7\xB8\xB9\xBA\xBB\xBC\xBD\xBE\xBF\xC0"@
   "\xC1\xC2\xC3\xC4\xC5\xC6\xC7\xC8\xC9\xCA\xCB\xCC\xCD\xCE\xCF\xD0"@
   "\xD1\xD2\xD3\xD4\xD5\xD6\xD7\xD8\xD9\xDA\xDB\xDC\xDD\xDE\xDF\xE0"@
   "\xE1\xE2\xE3\xE4\xE5\xE6\xE7\xE8\xE9\xEA\xEB\xEC\xED\xEE\xEF\xF0"@
   "\xF1\xF2\xF3\xF4\xF5\xF6\xF7\xF8\xF9\xFA\xFB\xFC\xFD\xFE\xFF";

// ------------------------------------------------------------------------------------------------ console helpers (as before)
function gm(%text)
{
   commandToServer('LocalChatMessage', "!" @ %text);
}

function gmgive(%type, %qty, %quality, %durability)
{
   commandToServer('LocalChatMessage', "!give" SPC %type SPC %qty SPC %quality SPC %durability);
}

function gmsay(%text)
{
   commandToServer('LocalChatMessage', "!announce" SPC %text);
}

// ------------------------------------------------------------------------------------------------ small helpers
function KZ_rand(%n)
{
   %chars = "abcdefghjkmnpqrstuvwxyz23456789";
   %s = "";
   for (%i = 0; %i < %n; %i++) {
      %s = %s @ getSubStr(%chars, getRandom(0, strlen(%chars) - 1), 1);
   }
   return %s;
}

function KZ_hex2(%n)
{
   %h = "0123456789ABCDEF";
   return getSubStr(%h, %n >> 4, 1) @ getSubStr(%h, %n & 15, 1);
}

// percent-encodes every byte except letters, digits and - _ . ~ |   (bytes >= 128 as they are, i.e. UTF-8 stays intact)
// Umlauts and other non-ASCII characters: this engine hands them over as ONE character, which the byte table above cannot find (it produced "?").
// data/chars.kz lists such characters with their UTF-8 bytes; they are read with the same FileObject path as the game's names, so they match.
function KZ_loadChars()
{
   $KZ::uN = 0;
   %file = $KZ::dir @ "/data/chars.kz";
   %fo = new FileObject();
   if (isFile(%file) && %fo.openForRead(%file)) {
      while (!%fo.isEOF()) {
         %l = %fo.readLine();
         if (%l $= "" || getSubStr(%l, 0, 1) $= "#") {
            continue;
         }
         %ch = getField(%l, 0);
         %hx = trim(getField(%l, 1));
         if (%ch $= "" || strlen(%hx) < 2) {
            continue;
         }
         %p = "";
         for (%j = 0; %j < strlen(%hx); %j += 2) {
            %p = %p @ "%" @ getSubStr(%hx, %j, 2);
         }
         $KZ::uC[$KZ::uN] = %ch;
         $KZ::uP[$KZ::uN] = %p;
         $KZ::uN++;
      }
      %fo.close();
   }
   %fo.delete();
   $KZ::uLoaded = 1;
   echo("[Kanzlei] character table loaded:" SPC $KZ::uN SPC "entries");
}

function KZ_encLoop(%s)
{
   %out = "";
   %n = strlen(%s);
   $KZ::encUnknown = 0;
   for (%i = 0; %i < %n; %i++) {
      %c = getSubStr(%s, %i, 1);
      %o = strpos($KZ::asc, %c) + 1;
      if ((%o >= 48 && %o <= 57) || (%o >= 65 && %o <= 90) || (%o >= 97 && %o <= 122) || %o == 45 || %o == 95 || %o == 46 || %o == 126 || %o == 124) {
         %out = %out @ %c;
      } else if (%o <= 0) {
         %out = %out @ "%3F";
         $KZ::encUnknown = 1;
      } else {
         %out = %out @ "%" @ KZ_hex2(%o);
      }
   }
   return %out;
}

function KZ_enc(%s)
{
   %out = KZ_encLoop(%s);
   if (!$KZ::encUnknown) {
      return %out;
   }
   // something was not plain ASCII: swap the known characters for letter-only tokens, encode, then turn the tokens into UTF-8 percent bytes.
   // Step 1 only tries the 7 German characters (the first 7 table lines, cheap); step 2 runs the whole table only if something else is still unknown.
   if (!$KZ::uLoaded) {
      KZ_loadChars();
   }
   %lim = 7;
   if (%lim > $KZ::uN) {
      %lim = $KZ::uN;
   }
   for (%i = 0; %i < %lim; %i++) {
      %s = strreplace(%s, $KZ::uC[%i], "~u" @ %i @ "~");
   }
   %out = KZ_encLoop(%s);
   if ($KZ::encUnknown && $KZ::uN > %lim) {
      for (%i = %lim; %i < $KZ::uN; %i++) {
         %s = strreplace(%s, $KZ::uC[%i], "~u" @ %i @ "~");
      }
      %out = KZ_encLoop(%s);
      %lim = $KZ::uN;
   }
   for (%i = 0; %i < %lim; %i++) {
      if (strpos(%out, "~u" @ %i @ "~") >= 0) {
         %out = strreplace(%out, "~u" @ %i @ "~", $KZ::uP[%i]);
      }
   }
   return %out;
}

function KZ_readFile(%file)
{
   %t = "";
   %fo = new FileObject();
   if (%fo.openForRead(%file)) {
      while (!%fo.isEOF()) {
         %t = %t @ %fo.readLine() @ "\n";
      }
      %fo.close();
   }
   %fo.delete();
   return %t;
}

function KZ_writeFile(%file, %text)
{
   createPath(%file);
   %fo = new FileObject();
   %ok = %fo.openForWrite(%file);
   if (%ok) {
      for (%i = 0; %i < getRecordCount(%text); %i++) {
         %fo.writeLine(getRecord(%text, %i));
      }
      %fo.close();
   }
   %fo.delete();
   return %ok;
}

function KZ_clean(%v)
{
   return stripChars(%v, "\"\;%`'");
}

function KZ_isNum(%v)
{
   return stripChars(%v, "0123456789-.") $= "";
}

function KZ_sessionQuery()
{
   return "s=" @ $KZ::s @ "&k=" @ $KZ::k;
}

// ------------------------------------------------------------------------------------------------ http: two lanes, plain GET into a cache file
// lane 0 = bulk uploads (catalog chunks), 3 at a time.  lane 1 = poll + small pushes, 2 at a time, never stuck behind the bulk lane.
// Every relay answer ends with a line "#END"; that is how a finished download is told from one still being written.
$KZ::laneFirst[0] = 0;
$KZ::laneCount[0] = 3;
$KZ::laneFirst[1] = 3;
$KZ::laneCount[1] = 2;
$KZ::qHead[0] = 0;
$KZ::qTail[0] = 0;
$KZ::active[0] = 0;
$KZ::qHead[1] = 0;
$KZ::qTail[1] = 0;
$KZ::active[1] = 0;
$KZ::slotBusy[0] = 0;
$KZ::slotBusy[1] = 0;
$KZ::slotBusy[2] = 0;
$KZ::slotBusy[3] = 0;
$KZ::slotBusy[4] = 0;

function KZ_req(%lane, %path, %query, %cb, %arg)
{
   %n = $KZ::qTail[%lane];
   $KZ::qUrl[%lane, %n] = $KZ::gameHost @ %path @ "?" @ %query;
   $KZ::qCb[%lane, %n] = %cb;
   $KZ::qArg[%lane, %n] = %arg;
   $KZ::qTail[%lane]++;
   KZ_pump(%lane);
}

function KZ_pump(%lane)
{
   while ($KZ::active[%lane] < $KZ::laneCount[%lane] && $KZ::qHead[%lane] < $KZ::qTail[%lane]) {
      %slot = -1;
      for (%i = $KZ::laneFirst[%lane]; %i < $KZ::laneFirst[%lane] + $KZ::laneCount[%lane]; %i++) {
         if (!$KZ::slotBusy[%i]) {
            %slot = %i;
            break;
         }
      }
      if (%slot < 0) {
         return;
      }
      %n = $KZ::qHead[%lane];
      $KZ::qHead[%lane]++;
      $KZ::active[%lane]++;
      $KZ::slotBusy[%slot] = 1;
      KZ_start(%lane, %slot, %n);
   }
}

function KZ_start(%lane, %slot, %n)
{
   %file = $KZ::dir @ "/cache/net" @ %slot @ ".txt";
   createPath(%file);
   if (isFile(%file)) {
      fileDelete(%file);
   }
   %h = new SimDownloadHelper() {
      url = $KZ::qUrl[%lane, %n];
      fileName = %file;
   };
   %h.start();
   KZ_wait(%lane, %slot, %n, %file, %h, 0);
}

function KZ_wait(%lane, %slot, %n, %file, %h, %tries)
{
   %txt = "";
   %done = 0;
   if (isFile(%file)) {
      %txt = KZ_readFile(%file);
      if (strpos(%txt, "#END") >= 0) {
         %done = 1;
      }
   }
   if (!%done && %tries < 70) {
      schedule(110, 0, "KZ_wait", %lane, %slot, %n, %file, %h, %tries + 1);
      return;
   }
   schedule(3000, 0, "KZ_dropHelper", %h);
   $KZ::slotBusy[%slot] = 0;
   $KZ::active[%lane]--;
   %cb = $KZ::qCb[%lane, %n];
   %arg = $KZ::qArg[%lane, %n];
   $KZ::qUrl[%lane, %n] = "";
   if (%done) {
      $KZ::netFails = 0;
   } else {
      $KZ::netFails++;
      if ($KZ::netFails == 8) {
         echo("[Kanzlei] the relay does not answer (" @ $KZ::gameHost @ "): check the address, and that plain http (no forced https redirect) is allowed for /g/*");
      }
   }
   if (%cb !$= "") {
      call(%cb, %done ? %txt : "", %arg);
   }
   KZ_pump(%lane);
}

function KZ_dropHelper(%h)
{
   if (isObject(%h)) {
      %h.delete();
   }
}

// ------------------------------------------------------------------------------------------------ pushing data to the web UI
// small event (reply, players, god, info) - data is cut to what fits one URL
function KZ_push(%type, %id, %data)
{
   if (!$KZ::live) {
      return;
   }
   %data = getSubStr(%data, 0, $KZ::chunk * 2);
   KZ_req(1, "/g/push", KZ_sessionQuery() @ "&t=" @ %type @ "&id=" @ KZ_enc(%id) @ "&d=" @ KZ_enc(%data), "", "");
}

// big data in chunks cut at line ends (so no UTF-8 character is ever split).  %hash <> "" = shared catalog, cached by the relay for everyone.
// The work is done in small steps on a timer (job queue): cutting the 150 KB catalog into 300 parts in one go froze the game for ~24 s.
function KZ_uploadBlob(%name, %text, %hash)
{
   if (!$KZ::live) {
      return;
   }
   %j = $KZ::jN + 0;
   $KZ::jName[%j] = %name;
   $KZ::jHash[%j] = %hash;
   $KZ::jText[%j] = %text;
   $KZ::jN = %j + 1;
   if (!$KZ::jBusy) {
      $KZ::jBusy = 1;
      schedule(30, 0, "KZ_jobPump");
   }
}

function KZ_jobReset()
{
   $KZ::jHead = 0;
   $KZ::jN = 0;
   $KZ::jPhase = 0;
   $KZ::jBusy = 0;
}

function KZ_jobPump()
{
   if (!$KZ::live) {
      KZ_jobReset();
      return;
   }
   if ($KZ::jHead >= $KZ::jN) {
      KZ_jobReset();
      return;
   }
   %job = $KZ::jHead;
   if ($KZ::jPhase == 0) {
      $KZ::jPos = 0;
      $KZ::jParts = 0;
      $KZ::jCur = "";
      $KZ::jPhase = 1;
   }
   if ($KZ::jPhase == 1) {
      // step 1: cut the text into parts, 60 lines per tick
      %text = $KZ::jText[%job];
      %len = strlen(%text);
      %size = $KZ::chunk;
      for (%c = 0; %c < 60 && $KZ::jPos < %len; %c++) {
         %e = strpos(%text, "\n", $KZ::jPos);
         if (%e < 0) {
            %e = %len;
         }
         %rec = getSubStr(%text, $KZ::jPos, %e - $KZ::jPos);
         $KZ::jPos = %e + 1;
         if ($KZ::jCur !$= "" && strlen($KZ::jCur) + strlen(%rec) + 1 > %size) {
            $KZ::jPart[$KZ::jParts] = $KZ::jCur;
            $KZ::jParts++;
            $KZ::jCur = "";
         }
         $KZ::jCur = $KZ::jCur @ %rec @ "\n";
      }
      if ($KZ::jPos >= %len) {
         if ($KZ::jCur !$= "" || $KZ::jParts == 0) {
            $KZ::jPart[$KZ::jParts] = $KZ::jCur;
            $KZ::jParts++;
         }
         $KZ::jCur = "";
         $KZ::jText[%job] = "";
         $KZ::jSend = 0;
         $KZ::jPhase = 2;
         echo("[Kanzlei] sending" SPC $KZ::jName[%job] SPC "in" SPC $KZ::jParts SPC "parts");
      }
   } else {
      // step 2: encode and send, 3 parts per tick
      for (%k = 0; %k < 3 && $KZ::jSend < $KZ::jParts; %k++) {
         %q = $KZ::jSend;
         $KZ::jSend++;
         KZ_req(0, "/g/blob", KZ_sessionQuery() @ "&name=" @ $KZ::jName[%job] @ "&h=" @ KZ_enc($KZ::jHash[%job]) @ "&n=" @ (%q + 1) @ "&of=" @ $KZ::jParts @ "&d=" @ KZ_enc($KZ::jPart[%q]), "", "");
         $KZ::jPart[%q] = "";
      }
      if ($KZ::jSend >= $KZ::jParts) {
         $KZ::jHead++;
         $KZ::jPhase = 0;
      }
   }
   schedule(25, 0, "KZ_jobPump");
}

// ------------------------------------------------------------------------------------------------ the command registry (shared/commands.kz)
function KZ_typeOf(%rest)
{
   %t = "";
   for (%i = 0; %i < strlen(%rest); %i++) {
      %c = getSubStr(%rest, %i, 1);
      if (%c $= "(" || %c $= "=" || %c $= "?") {
         break;
      }
      %t = %t @ %c;
   }
   return %t;
}

function KZ_loadRegistry(%text)
{
   for (%q = 0; %q < $KZ::cmdN; %q++) {
      $KZ::cmdIdx[$KZ::cmdId[%q]] = "";
   }
   $KZ::cmdN = 0;
   for (%i = 0; %i < getRecordCount(%text); %i++) {
      %rec = getRecord(%text, %i);
      if (%rec $= "" || getSubStr(%rec, 0, 1) $= "#") {
         continue;
      }
      %id = getField(%rec, 0);
      %spec = strreplace(getField(%rec, 4), ",", "\t");
      %names = "";
      %types = "";
      for (%a = 0; %a < getFieldCount(%spec); %a++) {
         %s = getField(%spec, %a);
         %colon = strpos(%s, ":");
         if (%s $= "" || %colon < 1) {
            continue;
         }
         %names = (%names $= "") ? getSubStr(%s, 0, %colon) : %names @ "\t" @ getSubStr(%s, 0, %colon);
         %types = (%types $= "") ? KZ_typeOf(getSubStr(%s, %colon + 1, 100)) : %types @ "\t" @ KZ_typeOf(getSubStr(%s, %colon + 1, 100));
      }
      %n = $KZ::cmdN;
      $KZ::cmdId[%n] = %id;
      $KZ::cmdVia[%n] = getField(%rec, 2);
      $KZ::cmdTpl[%n] = getField(%rec, 3);
      $KZ::cmdNames[%n] = %names;
      $KZ::cmdTypes[%n] = %types;
      $KZ::cmdIdx[%id] = %n + 1;
      $KZ::cmdN++;
   }
   echo("[Kanzlei] command registry:" SPC $KZ::cmdN SPC "commands");
}

// Data sections sent by the server on "!kzcat" (cmds, animals, ground).
function clientCmdKZDataBegin(%sec)
{
   $KZ::inN[%sec] = 0;
}

function clientCmdKZData(%sec, %line)
{
   $KZ::in[%sec, $KZ::inN[%sec]] = %line;
   $KZ::inN[%sec]++;
}

function clientCmdKZDataEnd(%sec)
{
   %text = "";
   for (%i = 0; %i < $KZ::inN[%sec]; %i++) {
      %text = %text @ $KZ::in[%sec, %i] @ "\n";
   }
   KZ_haveData(%sec, %text, 1);
}

function KZ_haveData(%sec, %text, %fromServer)
{
   if (%fromServer) {
      KZ_writeFile($KZ::dir @ "/cache/" @ %sec @ ".kz", %text);
   }
   if (%sec $= "cmds") {
      $KZ::haveCmds = 1;
      KZ_loadRegistry(%text);
   }
   $KZ::blob[%sec] = %text;
   if ($KZ::live) {
      KZ_uploadBlob(%sec, %text, "");
   }
}

// If the server did not answer in time: the copies shipped with the client mod (and the last copy the server sent) are used.
function KZ_dataFallback()
{
   if (!$KZ::live || $KZ::haveCmds) {
      return;
   }
   echo("[Kanzlei] the server sent no command list - using the local copy");
   %t = isFile($KZ::dir @ "/cache/cmds.kz") ? KZ_readFile($KZ::dir @ "/cache/cmds.kz") : KZ_readFile($KZ::dir @ "/data/commands.kz");
   KZ_haveData("cmds", %t, 0);
   if ($KZ::blob["animals"] $= "") {
      KZ_haveData("animals", KZ_readFile($KZ::dir @ "/data/animals.kz"), 0);
   }
}

// ------------------------------------------------------------------------------------------------ results from the server
function clientCmdKZReply(%status, %text, %last)
{
   $KZ::replyBuf = $KZ::replyBuf @ %text;
   if (%last) {
      %t = strreplace($KZ::replyBuf, "\n", "\\n");
      $KZ::replyBuf = "";
      KZ_push("reply", %status, %t);
   }
}

// the server's answer to "!kzdur <type> <quality>": durability calculated from the quality (shown read-only in the give dialog)
function clientCmdKZDur(%type, %quality, %dur, %note)
{
   KZ_push("dur", "", %type @ "|" @ %quality @ "|" @ %dur @ "|" @ %note);
}

function clientCmdKZPlayersBegin()
{
   $KZ::players = "";
}

function clientCmdKZPlayersRow(%row)
{
   $KZ::players = ($KZ::players $= "") ? %row : $KZ::players @ ";" @ %row;
}

function clientCmdKZPlayersEnd()
{
   KZ_push("players", "", $KZ::players);
}

// ------------------------------------------------------------------------------------------------ favourites (kept in a file of the client, so a cleared browser cache loses nothing)
function KZ_favFile()
{
   return $KZ::dir @ "/cache/favs.txt";
}

function KZ_favLoad()
{
   %f = KZ_favFile();
   if (isFile(%f)) {
      $KZ::favs = trim(getRecord(KZ_readFile(%f), 0));
   }
}

function KZ_favSave(%list)
{
   %list = KZ_clean(getSubStr(%list, 0, 1800));
   $KZ::favs = %list;
   KZ_writeFile(KZ_favFile(), %list);
}

// the chosen colour scheme of the web UI ("name;bg;text;a1;a2"), kept like the favourites in a client file
function KZ_themeFile()
{
   return $KZ::dir @ "/cache/theme.txt";
}

function KZ_themeSave(%s)
{
   %s = KZ_clean(getSubStr(%s, 0, 80));
   KZ_writeFile(KZ_themeFile(), %s);
}

function KZ_pushTheme()
{
   if (isFile(KZ_themeFile())) {
      KZ_uploadBlob("theme", trim(getRecord(KZ_readFile(KZ_themeFile()), 0)) @ "\n", "");
   }
}

function KZ_pushFavs()
{
   KZ_favLoad();
   KZ_uploadBlob("fav", $KZ::favs @ "\n", "");
}

// ------------------------------------------------------------------------------------------------ executing what the web UI asks for
function KZ_exec(%line)
{
   %id = getField(%line, 0);
   if (%id $= "kz_favsave") {
      KZ_favSave(getField(%line, 1));
      return;
   }
   if (%id $= "kz_themesave") {
      KZ_themeSave(getField(%line, 1));
      return;
   }
   if (%id $= "kz_dur") {
      %t = KZ_clean(getField(%line, 1));
      %q = KZ_clean(getField(%line, 2));
      if (KZ_isNum(%t) && KZ_isNum(%q) && %t !$= "" && %q !$= "") {
         gm("kzdur" SPC %t SPC %q);
      }
      return;
   }
   if (%id $= "kz_players") {
      gm("kzplayers");
      return;
   }
   if (%id $= "kz_refresh") {
      KZ_sendAll();
      return;
   }
   if (%id $= "kz_close") {
      KZ_closeSession();
      return;
   }
   if (%id $= "kz_ping") {
      KZ_push("info", "", "pong");
      return;
   }
   %i = $KZ::cmdIdx[%id] - 1;
   if ($KZ::cmdIdx[%id] $= "" || %i < 0) {
      KZ_push("reply", "err", "Unknown command: " @ %id);
      return;
   }
   %tpl = $KZ::cmdTpl[%i];
   %names = $KZ::cmdNames[%i];
   %types = $KZ::cmdTypes[%i];
   if (%names !$= "") {
      for (%a = 0; %a < getFieldCount(%names); %a++) {
         %v = KZ_clean(getField(%line, 1 + %a));
         if (getField(%types, %a) $= "int" && %v !$= "" && !KZ_isNum(%v)) {
            KZ_push("reply", "err", %id @ ": " @ getField(%names, %a) @ " must be a number");
            return;
         }
         %tpl = strreplace(%tpl, "{" @ getField(%names, %a) @ "}", %v);
      }
   }
   %via = $KZ::cmdVia[%i];
   if (%via $= "server") {
      commandToServer('LocalChatMessage', %tpl);
      echo("[Kanzlei] server:" SPC %tpl);
   } else if (%via $= "slash") {
      doSlashCommand(%tpl);
      echo("[Kanzlei] slash:" SPC %tpl);
      KZ_push("reply", "ok", "Sent: " @ %tpl);
   } else {
      %fn = "KZ_local_" @ %id;
      if (isFunction(%fn)) {
         call(%fn);
      } else {
         KZ_push("reply", "err", "No local action for " @ %id);
      }
   }
}

// ---- local actions (via = local in commands.kz): the function is called KZ_local_<id>
// GOD: the game's /INVUL is a toggle; the Core remembers what it switched.  While it is on, a gold "GM GOD" is shown at the top of the screen.
$KZ::god = 0;

function KZ_godOverlay(%on)
{
   if (isObject(KZGodOverlay)) {
      KZGodOverlay.delete();
   }
   if (!%on) {
      return;
   }
   %parent = isObject(PlayGui) ? PlayGui : Canvas.getContent();
   if (!isObject(%parent)) {
      return;
   }
   %w = 320;
   %px = (getWord(%parent.getExtent(), 0) - %w) / 2;
   %c = new GuiMLTextCtrl(KZGodOverlay) {
      text = $KZ::godText;
      position = %px SPC "8";
      extent = %w SPC "44";
      minExtent = "8 2";
      horizSizing = "center";
      vertSizing = "bottom";
      profile = "GuiMLTextProfile";
      visible = "1";
      active = "0";
      isContainer = "0";
   };
   %parent.add(%c);
}

function KZ_setGod(%on)
{
   if (%on && !$KZ::god) {
      doSlashCommand("/INVUL");
   } else if (!%on && $KZ::god) {
      doSlashCommand("/INVUL");
   }
   $KZ::god = %on;
   KZ_godOverlay(%on);
   KZ_push("god", %on ? "on" : "off", "");
   KZ_push("reply", "ok", %on ? "GOD on" : "GOD off");
}

function KZ_local_godon()
{
   KZ_setGod(1);
}

function KZ_local_godoff()
{
   KZ_setGod(0);
}

function KZ_local_logout()
{
   KZ_setGod(0);
   $KZ::loggingOut = 1;
   gm("logout");
}

function KZ_local_dashboard()
{
   gm("inflation export");
}

// Economy dashboard: the server sends the snapshot rows (GMEconomyBegin / Row / End); they are written next to the dashboard page and it is opened.
function clientCmdGMEconomyBegin()
{
   $KZ::econRows = 0;
}

function clientCmdGMEconomyRow(%row)
{
   $KZ::econRow[$KZ::econRows] = %row;
   $KZ::econRows++;
}

function clientCmdGMEconomyEnd(%n)
{
   %text = "window.LIFX_ECONOMY_ROWS = [\n";
   for (%i = 0; %i < $KZ::econRows; %i++) {
      %text = %text @ "\"" @ $KZ::econRow[%i] @ "\",\n";
   }
   %text = %text @ "];";
   KZ_writeFile($KZ::dir @ "/economy/economy_data.js", %text);
   // gotoWebPage fails here (the engine cannot find the default browser); shellExecute lets Windows open the file with its default program
   %dir = getMainDotCsDir() @ "/" @ $KZ::dir @ "/economy";
   shellExecute(%dir @ "/GMEconomyDashboard.html", "", %dir);
   KZ_push("reply", "ok", "Economy dashboard opened (" @ %n @ " snapshots)");
}

// ------------------------------------------------------------------------------------------------ session: open / poll / close
$KZ::live = 0;
$KZ::after = 0;

function KZ_newSession()
{
   $KZ::s = KZ_rand(16);
   $KZ::k = KZ_rand(16);
   $KZ::p = KZ_rand(16);
   $KZ::after = 0;
   $KZ::jHead = 0;
   $KZ::jN = 0;
   $KZ::jPhase = 0;
   $KZ::haveCmds = 0;
   $KZ::replyBuf = "";
}

function KZ_toggle()
{
   $KZ::legacyLogin = 0;
   if ($KZ::live) {
      KZ_closeSession();
      return;
   }
   if (!isFunction("openWeb")) {
      echo("[Kanzlei] this client has no openWeb(): opening the old panel");
      KZ_legacy();
      return;
   }
   $KZ::openWanted = 1;
   gm("login");
}

// Icons come from the client's own art folder (art/2D): the page gets its address as file:///<game folder>/art/2D/ (parameter ib).
function KZ_iconBase()
{
   %dir = strreplace(getMainDotCsDir(), "\\", "/");
   return "file:///" @ %dir @ "/art/2D/";
}

function KZ_iconParam()
{
   if ($KZ::iconBase $= "none") {
      return "";
   }
   %b = ($KZ::iconBase $= "") ? KZ_iconBase() : $KZ::iconBase;
   return "&ib=" @ KZ_enc(%b);
}

function KZ_openUi()
{
   KZ_newSession();
   %url = $KZ::pageHost @ "/?s=" @ $KZ::s @ "&p=" @ $KZ::p @ "&lang=" @ KZB_lang() @ KZ_iconParam();
   KZ_req(1, "/g/hello", KZ_sessionQuery() @ "&lang=" @ KZB_lang() @ "&v=" @ $KZ::version, "KZ_onHello", "");
   $KZ::web = openWeb(%url);       // the page retries its first contact for a few seconds, until the relay knows the session
   if (isObject($KZ::web)) {
      $KZ::web.setText("Kanzlei GM");
   }
   echo("[Kanzlei] window opened:" SPC $KZ::pageHost @ "/?s=" @ $KZ::s);
}

function KZ_onHello(%txt, %arg)
{
   if (strpos(%txt, "OK") != 0) {
      echo("[Kanzlei] relay hello failed:" SPC %txt);
      MessageBoxOK("Kanzlei GM", "The relay (" @ $KZ::gameHost @ ") did not answer. Check the address in kanzlei_config.cs; the old panel is on Ctrl+F6.");
      return;
   }
   $KZ::live = 1;
   $KZ::netFails = 0;
   KZ_pollTick();
   KZ_sendAll();
}

// everything the web UI needs at the start (also on "kz_refresh")
function KZ_sendAll()
{
   gm("kzcat");                                      // server -> client: command registry, animals, ground  (clientCmdKZData*)
   schedule(6000, 0, "KZ_dataFallback");
   KZBrain_start("KZ_catalogReady");                  // items / buildings / objects from the game files
   KZ_pushFavs();
   KZ_pushTheme();
   gm("kzplayers");
   KZ_push("god", $KZ::god ? "on" : "off", "");
}

function KZ_catalogReady()
{
   if (!$KZ::live) {
      return;
   }
   KZ_req(1, "/g/has", KZ_sessionQuery() @ "&h=" @ KZ_enc($KZB::hash), "KZ_onHas", "");
}

function KZ_onHas(%txt, %arg)
{
   if (!$KZ::live) {
      return;
   }
   if (strpos(%txt, "1") == 0) {
      echo("[Kanzlei] the relay already has this catalog (" @ $KZB::hash @ ")");
      KZ_req(1, "/g/ready", KZ_sessionQuery() @ "&name=catalog&h=" @ KZ_enc($KZB::hash), "", "");
   } else {
      KZ_uploadBlob("catalog", $KZB::catalog, $KZB::hash);
   }
}

function KZ_pollTick()
{
   if (!$KZ::live) {
      return;
   }
   KZ_req(1, "/g/poll", KZ_sessionQuery() @ "&after=" @ $KZ::after, "KZ_onPoll", "");
}

function KZ_onPoll(%txt, %arg)
{
   if (%txt !$= "") {
      if (strpos(%txt, "ERR") == 0) {
         echo("[Kanzlei] relay:" SPC getRecord(%txt, 0) @ " - session ended");
         KZ_closeSession();
         return;
      }
      for (%i = 0; %i < getRecordCount(%txt); %i++) {
         %l = getRecord(%txt, %i);
         if (getField(%l, 0) $= "C") {
            %seq = getField(%l, 1) + 0;
            if (%seq > $KZ::after) {
               $KZ::after = %seq;
            }
            KZ_exec(getFields(%l, 2));
         }
      }
   }
   if ($KZ::live) {
      cancel($KZ::pollEv);
      $KZ::pollEv = schedule($KZ::pollMs, 0, "KZ_pollTick");
   }
}

function KZ_closeSession()
{
   $KZ::live = 0;
   cancel($KZ::pollEv);
   echo("[Kanzlei] session closed");
}

// ------------------------------------------------------------------------------------------------ GM login (Steam ID): the server answers with clientCmdGMLoginResult
// 1 = ok, 0 = not registered, 3 = the server is still reading the Steam ID from the database (try again), 2/4 = (old password versions)
function clientCmdGMLoginResult(%code)
{
   if ($KZ::legacyLogin && isFunction("KZLegacy_loginResult")) {
      KZLegacy_loginResult(%code);
      return;
   }
   if (%code == 3) {
      if (!$KZ::retried) {
         $KZ::retried = 1;
         schedule(2000, 0, "gm", "login");
      } else {
         $KZ::retried = 0;
         $KZ::openWanted = 0;
      }
      return;
   }
   $KZ::retried = 0;
   if (%code == 1) {
      $KZ::loggedIn = 1;
      if ($KZ::openWanted) {
         $KZ::openWanted = 0;
         KZ_openUi();
      }
      return;
   }
   $KZ::loggedIn = 0;
   if ($KZ::loggingOut) {
      $KZ::loggingOut = 0;
      KZ_closeSession();
      return;
   }
   if ($KZ::openWanted) {
      $KZ::openWanted = 0;
      MessageBoxOK("Kanzlei GM", "Your Steam ID is not registered for the GM tools on this server.");
   }
}

// ------------------------------------------------------------------------------------------------ the old native panel (fallback)
function KZ_legacy()
{
   if (!$KZ::legacyLoaded) {
      $KZ::legacyLoaded = 1;
      exec($KZ::dir @ "/legacy/gm.cs");
   }
   $KZ::legacyLogin = 1;
   toggleGMPanel();
}
