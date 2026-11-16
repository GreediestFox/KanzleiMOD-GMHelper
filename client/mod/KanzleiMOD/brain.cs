// KanzleiMOD - BRAIN: preloads the game data the GM window needs, always from the CLIENT'S OWN FILES, so the lists follow the game and every mod:
//   data/objects_types.xml                          what exists (id, parent, name, movable / unmovable, icon)
//   data/cm_objects.xml                             which of them have a 3D model (= can be placed)
//   data/loc/<language>/data/objects_types_Name.xml the names in the language set in the game ($pref::language::pack), English as fallback
// Result: $KZB::catalog = the catalog text the web UI loads ("C|id|name" categories, "b|m|i|id|cat|name|icon"), plus a hash of it.
// The work is spread over many short timer ticks, so the game does not freeze while it reads ~70 000 lines.
// Hidden ids come from data/hidden.kz (shared/hidden.kz), nothing is hardcoded here.

$KZB::state = 0;            // 0 = not started, 1 = reading, 2 = ready
$KZB::linesPerTick = 500;
$KZB::catDepth = 2;         // category = the ancestor this many steps below the root of the object type tree

function KZB_dataDir()
{
   return "data";
}

function KZB_lang()
{
   %l = $pref::language::pack;
   if (%l $= "") {
      %l = "en";
   }
   return strlwr(%l);
}

// ---- small helpers -------------------------------------------------------------------------------------------------
function KZB_unescape(%s)
{
   %s = strreplace(%s, "&lt;", "<");
   %s = strreplace(%s, "&gt;", ">");
   %s = strreplace(%s, "&quot;", "'");
   %s = strreplace(%s, "&apos;", "'");
   %s = strreplace(%s, "&amp;", "&");
   return %s;
}

// "<Tag>value</Tag>"  ->  sets %KZB_tag / returns value; call KZB_tagName first
function KZB_tagName(%l)
{
   %gt = strpos(%l, ">");
   if (getSubStr(%l, 0, 1) !$= "<" || %gt < 2) {
      return "";
   }
   return getSubStr(%l, 1, %gt - 1);
}

function KZB_tagValue(%l)
{
   %gt = strpos(%l, ">");
   %lt = strpos(%l, "<", %gt + 1);
   if (%lt < 0) {
      return "";
   }
   return getSubStr(%l, %gt + 1, %lt - %gt - 1);
}

// ---- hidden ids (data/hidden.kz) ---------------------------------------------------------------------------------------
function KZB_loadHidden()
{
   $KZB::hiddenN = 0;
   %file = $KZ::dir @ "/data/hidden.kz";
   if (!isFile(%file)) {
      return;
   }
   %fo = new FileObject();
   if (%fo.openForRead(%file)) {
      while (!%fo.isEOF()) {
         %l = trim(%fo.readLine());
         if (%l $= "" || getSubStr(%l, 0, 1) $= "#") {
            continue;
         }
         %tok = getField(%l, 0);                       // "2461-2466" or "2399" (a comment may follow after a TAB)
         %dash = strpos(%tok, "-");
         if (%dash > 0) {
            $KZB::hiLo[$KZB::hiddenN] = getSubStr(%tok, 0, %dash) + 0;
            $KZB::hiHi[$KZB::hiddenN] = getSubStr(%tok, %dash + 1, 20) + 0;
         } else {
            $KZB::hiLo[$KZB::hiddenN] = %tok + 0;
            $KZB::hiHi[$KZB::hiddenN] = %tok + 0;
         }
         $KZB::hiddenN++;
      }
      %fo.close();
   }
   %fo.delete();
}

function KZB_isHidden(%id)
{
   for (%i = 0; %i < $KZB::hiddenN; %i++) {
      if (%id >= $KZB::hiLo[%i] && %id <= $KZB::hiHi[%i]) {
         return 1;
      }
   }
   return 0;
}

// ---- stage control -------------------------------------------------------------------------------------------------
// Call KZBrain_start(%callback) - the callback (a function name, no arguments) runs when the catalog is ready.
function KZBrain_start(%callback)
{
   if ($KZB::state == 2 && $KZB::langBuilt $= KZB_lang()) {
      if (%callback !$= "") {
         call(%callback);
      }
      return;
   }
   if ($KZB::state == 1) {
      $KZB::cb2 = %callback;       // already reading: just remember who wants to be told
      return;
   }
   $KZB::state = 1;
   $KZB::cb = %callback;
   $KZB::cb2 = "";
   $KZB::stage = 0;
   $KZB::n = 0;
   $KZB::inCmt = 0;
   $KZB::lang = KZB_lang();
   KZB_loadHidden();
   $KZB::status = "reading objects_types.xml";
   KZB_openStage();
   schedule(10, 0, "KZB_tick");
}

function KZB_openStage()
{
   if (isObject($KZB::fo)) {
      $KZB::fo.close();
      $KZB::fo.delete();
   }
   $KZB::fo = new FileObject();
   $KZB::inCmt = 0;
   %file = "";
   if ($KZB::stage == 0) {
      %file = KZB_dataDir() @ "/objects_types.xml";
   } else if ($KZB::stage == 1) {
      %file = KZB_dataDir() @ "/cm_objects.xml";
   } else if ($KZB::stage == 2) {
      %file = KZB_dataDir() @ "/loc/en/data/objects_types_Name.xml";
   } else if ($KZB::stage == 3) {
      %file = KZB_dataDir() @ "/loc/" @ $KZB::lang @ "/data/objects_types_Name.xml";
   }
   // stage 2 is English (fallback), stage 3 the game language (overrides it). Missing file = skip the stage.
   if (%file $= "" || !isFile(%file) || !$KZB::fo.openForRead(%file)) {
      if ($KZB::stage == 0) {
         echo("[Kanzlei] Brain: cannot read" SPC %file SPC "- the catalog stays empty");
      }
      $KZB::fo.delete();
      $KZB::fo = 0;
      return 0;
   }
   $KZB::row = 0;
   return 1;
}

function KZB_nextStage()
{
   $KZB::stage++;
   if ($KZB::stage > 3) {
      KZB_build();
      return;
   }
   if ($KZB::stage == 3 && $KZB::lang $= "en") {
      KZB_nextStage();     // English is already loaded
      return;
   }
   if (!KZB_openStage()) {
      KZB_nextStage();
   }
}

function KZB_tick()
{
   if (!isObject($KZB::fo)) {
      KZB_nextStage();
      if ($KZB::state == 1) {
         schedule(10, 0, "KZB_tick");
      }
      return;
   }
   %fo = $KZB::fo;
   for (%c = 0; %c < $KZB::linesPerTick && !%fo.isEOF(); %c++) {
      %l = trim(%fo.readLine());
      if ($KZB::stage == 0) {
         KZB_lineTypes(%l);
      } else if ($KZB::stage == 1) {
         KZB_lineModels(%l);
      } else {
         KZB_lineLoc(%l);
      }
   }
   if (%fo.isEOF()) {
      %fo.close();
      %fo.delete();
      $KZB::fo = 0;
   }
   if ($KZB::state == 1) {
      schedule(5, 0, "KZB_tick");
   }
}

// comment handling shared by the XML stages: returns 1 when the line must be ignored
function KZB_skipComment(%l)
{
   if ($KZB::inCmt) {
      if (strpos(%l, "-->") >= 0) {
         $KZB::inCmt = 0;
      }
      return 1;
   }
   if (strpos(%l, "<!--") >= 0) {
      if (strpos(%l, "-->") < 0) {
         $KZB::inCmt = 1;
      }
      return 1;
   }
   return 0;
}

// ---- stage 0: objects_types.xml -------------------------------------------------------------------------------------------
function KZB_lineTypes(%l)
{
   if (KZB_skipComment(%l)) {
      return;
   }
   if (%l $= "<row>") {
      $KZB::cur = "";
      $KZB::cParent = 0;
      $KZB::cName = "";
      $KZB::cMov = 0;
      $KZB::cUnm = 0;
      $KZB::cFace = "";
      return;
   }
   if (%l $= "</row>") {
      if ($KZB::cur !$= "") {
         %id = $KZB::cur;
         $KZB::t[%id] = 1;
         $KZB::tParent[%id] = $KZB::cParent;
         $KZB::tName[%id] = $KZB::cName;
         $KZB::tMov[%id] = $KZB::cMov;
         $KZB::tUnm[%id] = $KZB::cUnm;
         $KZB::tFace[%id] = $KZB::cFace;
         $KZB::ids[$KZB::n] = %id;
         $KZB::n++;
         if ($KZB::cParent > 0) {
            $KZB::isParent[$KZB::cParent] = 1;
         }
      }
      $KZB::cur = "";
      return;
   }
   %tag = KZB_tagName(%l);
   if (%tag $= "ID") {
      $KZB::cur = KZB_tagValue(%l) + 0;
   } else if (%tag $= "ParentID") {
      $KZB::cParent = KZB_tagValue(%l) + 0;
   } else if (%tag $= "Name") {
      $KZB::cName = KZB_unescape(KZB_tagValue(%l));
   } else if (%tag $= "IsMovableObject") {
      $KZB::cMov = (KZB_tagValue(%l) == 1);
   } else if (%tag $= "IsUnmovableobject") {
      $KZB::cUnm = (KZB_tagValue(%l) == 1);
   } else if (%tag $= "FaceImage") {
      $KZB::cFace = KZB_tagValue(%l);
   }
}

// ---- stage 1: cm_objects.xml  (<object id="123" ...>) -------------------------------------------------------------------
function KZB_lineModels(%l)
{
   if (KZB_skipComment(%l)) {
      return;
   }
   %p = strpos(%l, "<object id=\"");
   if (%p == 0) {
      %rest = getSubStr(%l, 12, 12);
      %q = strpos(%rest, "\"");
      if (%q > 0) {
         $KZB::model[getSubStr(%rest, 0, %q) + 0] = 1;
      }
   }
}

// ---- stages 2 and 3: localisation  (<string id="123">Name</string>) -----------------------------------------------------
function KZB_lineLoc(%l)
{
   if (getSubStr(%l, 0, 12) !$= "<string id=\"") {
      return;
   }
   %rest = getSubStr(%l, 12, 1000);
   %q = strpos(%rest, "\"");
   if (%q < 1) {
      return;
   }
   %id = getSubStr(%rest, 0, %q) + 0;
   %gt = strpos(%rest, ">");
   %end = strpos(%rest, "</string>");
   if (%gt < 0 || %end < %gt) {
      return;
   }
   $KZB::loc[%id] = KZB_unescape(getSubStr(%rest, %gt + 1, %end - %gt - 1));
}

// ---- build the catalog ----------------------------------------------------------------------------------------------------
function KZB_nameOf(%id)
{
   if ($KZB::loc[%id] !$= "") {
      return $KZB::loc[%id];
   }
   return $KZB::tName[%id];
}

function KZB_clean(%s)
{
   // the catalog format uses | and newlines as separators
   return strreplace(strreplace(strreplace(%s, "|", "/"), "\n", " "), "\r", " ");
}

// The "category" of a type: climb to the root of the parent chain, take the entry $KZB::catDepth steps below it.
function KZB_catOf(%id)
{
   %n = 0;
   %cur = %id;
   while (%cur > 0 && $KZB::t[%cur] && %n < 12) {
      %chain[%n] = %cur;
      %n++;
      %cur = $KZB::tParent[%cur];
   }
   if (%n < 2) {
      return 0;
   }
   %idx = %n - 1 - $KZB::catDepth;
   if (%idx < 0) {
      %idx = 0;
   }
   if (%idx == 0 && %n > 1) {
      %idx = 1;     // never the object itself as its own category
   }
   return %chain[%idx];
}

function KZB_build()
{
   $KZB::status = "building catalog";
   for (%k = 0; %k < $KZB::n; %k++) {
      $KZB::catUsed[$KZB::ids[%k]] = 0;
   }
   %lines = "";
   %catSeen = "";
   %sum = 0;
   %count = 0;
   for (%k = 0; %k < $KZB::n; %k++) {
      %id = $KZB::ids[%k];
      %name = KZB_nameOf(%id);
      if (%name $= "" || KZB_isHidden(%id)) {
         continue;
      }
      %kind = "";
      if ($KZB::tUnm[%id] && $KZB::model[%id]) {
         %kind = "b";
      } else if ($KZB::tMov[%id] && $KZB::model[%id]) {
         %kind = "m";
      } else if (!$KZB::model[%id] && !$KZB::isParent[%id] && $KZB::tFace[%id] !$= "" && !$KZB::tMov[%id] && !$KZB::tUnm[%id]) {
         %kind = "i";
      }
      if (%kind $= "") {
         continue;
      }
      %cat = KZB_catOf(%id);
      if (%cat > 0 && !$KZB::catUsed[%cat]) {
         $KZB::catUsed[%cat] = 1;
         %catSeen = %catSeen @ "C|" @ %cat @ "|" @ KZB_clean(KZB_nameOf(%cat)) @ "\n";
      }
      %icon = strreplace($KZB::tFace[%id], "\\", "/");
      if (strpos(strlwr(%icon), "art/2d/") == 0) {
         %icon = getSubStr(%icon, 7, 300);
      }
      %lines = %lines @ %kind @ "|" @ %id @ "|" @ %cat @ "|" @ KZB_clean(%name) @ "|" @ %icon @ "\n";
      %sum = (%sum + %id * 7 + strlen(%name) * 13 + strlen(%icon)) % 1000003;
      %count++;
   }
   $KZB::catalog = %catSeen @ %lines;
   $KZB::count = %count;
   $KZB::hash = "k" @ %count @ "x" @ %sum @ "x" @ $KZB::lang;
   $KZB::langBuilt = $KZB::lang;
   $KZB::state = 2;
   $KZB::status = "ready";
   echo("[Kanzlei] Brain ready:" SPC %count SPC "catalog entries, language" SPC $KZB::lang SPC "hash" SPC $KZB::hash);
   %cb = $KZB::cb;
   %cb2 = $KZB::cb2;
   $KZB::cb = "";
   $KZB::cb2 = "";
   if (%cb !$= "") {
      call(%cb);
   }
   if (%cb2 !$= "" && %cb2 !$= %cb) {
      call(%cb2);
   }
}

// Animals: the shipped / server-sent animals.kz is handled by the Core (it travels with the command registry).
