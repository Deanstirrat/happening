export type InstagramAccount = {
  handle: string;
  venueName: string;
  /** "venue" → image-first extraction (Claude vision)
   *  "promoter" → caption-first extraction (Claude haiku, cheaper) */
  tier: "venue" | "promoter";
};

/**
 * SF Instagram accounts to monitor for event posts.
 *
 * Venue accounts post structured flyers — vision extraction is worth the cost.
 * Promoter/DJ accounts put event details in the caption — text extraction suffices.
 *
 * Adding or removing accounts requires no code changes; just edit this list.
 */
export const INSTAGRAM_ACCOUNTS: InstagramAccount[] = [

  // ── Music venues ─────────────────────────────────────────────────────────
  { handle: "slimssf",               venueName: "Slim's",                  tier: "venue" },
  { handle: "bottomofthehillsf",     venueName: "Bottom of the Hill",      tier: "venue" },
  { handle: "theindependentsf",      venueName: "The Independent",         tier: "venue" },
  { handle: "thefillmore",           venueName: "The Fillmore",            tier: "venue" },
  { handle: "thewarfieldtheatre",    venueName: "The Warfield",            tier: "venue" },
  { handle: "august_hall_sf",        venueName: "August Hall",             tier: "venue" },
  { handle: "bimbossf",              venueName: "Bimbo's 365 Club",        tier: "venue" },
  { handle: "hemlocktavernsf",       venueName: "Hemlock Tavern",          tier: "venue" },
  { handle: "brickmortarsf",         venueName: "Brick & Mortar Music Hall", tier: "venue" },
  { handle: "theeparkside",          venueName: "The Parkside",            tier: "venue" },
  { handle: "hotelutah",             venueName: "Hotel Utah",              tier: "venue" },
  { handle: "thechapelsf",           venueName: "The Chapel",              tier: "venue" },
  { handle: "roxie_theater",         venueName: "Roxie Theater",           tier: "venue" },
  { handle: "theroyalcuckooorganlounge", venueName: "The Royal Cuckoo",    tier: "venue" },

  // ── Clubs & nightlife ────────────────────────────────────────────────────
  { handle: "cafedunord",            venueName: "Cafe du Nord",            tier: "venue" },
  { handle: "1015folsom",            venueName: "1015 Folsom",             tier: "venue" },
  { handle: "rickshawsf",            venueName: "Rickshaw Stop",           tier: "venue" },
  { handle: "themidwaysf",           venueName: "The Midway",              tier: "venue" },
  { handle: "halcyon_sf",            venueName: "Halcyon",                 tier: "venue" },
  { handle: "nyxlatenight",          venueName: "Nyx",                     tier: "venue" },
  { handle: "1015sf",                venueName: "1015 Folsom",             tier: "venue" }, // verify vs 1015folsom
  { handle: "buttersf",              venueName: "Butter",                  tier: "venue" },
  { handle: "strut_sf_",             venueName: "Strut",                   tier: "venue" },
  { handle: "batcavesf",             venueName: "The Bat Cave",            tier: "venue" },
  { handle: "theknockoutsf",         venueName: "The Knockout",            tier: "venue" },
  { handle: "el_gaaarage",           venueName: "El Gaaarage",             tier: "venue" },

  // ── Bars with regular programming ────────────────────────────────────────
  { handle: "madroneartbar",         venueName: "Madrone Art Bar",         tier: "venue" },
  { handle: "elriosf",               venueName: "El Rio",                  tier: "venue" },
  { handle: "jolenessf",             venueName: "Jolene's",                tier: "venue" },
  { handle: "emmysspaghettishack",   venueName: "Emmy's Spaghetti Shack",  tier: "venue" },
  { handle: "welcometomannys",       venueName: "Manny's",                 tier: "venue" },
  { handle: "zeitgeist_sf",          venueName: "Zeitgeist",               tier: "venue" },
  { handle: "pier70sf",              venueName: "Pier 70",                 tier: "venue" },
  { handle: "missionbowlingclub",    venueName: "Mission Bowling Club",    tier: "venue" },
  { handle: "whiteowlsocialclub",    venueName: "White Owl Social Club",   tier: "venue" },
  { handle: "hitopssf",              venueName: "Hi Tops",                 tier: "venue" },
  { handle: "jackalopebarsf",        venueName: "Jackalope Bar",           tier: "venue" },
  { handle: "mayessf",               venueName: "Mayes",                   tier: "venue" },
  { handle: "zekisbar",              venueName: "Zeki's Bar",              tier: "venue" },
  { handle: "tempestbarandbox",      venueName: "Tempest",                 tier: "venue" },
  { handle: "thepagebar_sf",         venueName: "The Page Bar",            tier: "venue" },
  { handle: "acesbarsf",             venueName: "Aces Bar",                tier: "venue" },
  { handle: "sycamorebeer",          venueName: "Sycamore",                tier: "venue" },
  { handle: "thedetoursf",           venueName: "The Detour",              tier: "venue" },
  { handle: "providence_sf",         venueName: "Providence",              tier: "venue" },
  { handle: "standarddeviantbrewing",venueName: "Standard Deviant Brewing",tier: "venue" },
  { handle: "tiltedbrimsf",          venueName: "Tilted Brim",             tier: "venue" },
  { handle: "teethbarsf",            venueName: "Teeth Bar",               tier: "venue" },
  { handle: "haziesonhayes",         venueName: "Hazies on Hayes",         tier: "venue" },
  { handle: "lastritesbar",          venueName: "Last Rites",              tier: "venue" },
  { handle: "smugglerscovesf",       venueName: "Smuggler's Cove",         tier: "venue" },
  { handle: "lagunitasbeer",         venueName: "Lagunitas SF Taproom",    tier: "venue" },
  { handle: "laszlobarsf",           venueName: "Laszlo Bar",              tier: "venue" },
  { handle: "sunsetcantinasf",       venueName: "Sunset Cantina",          tier: "venue" },
  { handle: "buenavistataproom",     venueName: "Buena Vista Taproom",     tier: "venue" },
  { handle: "therumpusroomsf",       venueName: "The Rumpus Room",         tier: "venue" },
  { handle: "popsbar",               venueName: "Pop's Bar",               tier: "venue" },
  { handle: "elixirsf",              venueName: "Elixir",                  tier: "venue" },
  { handle: "ryebarsf",              venueName: "Rye Bar",                 tier: "venue" },
  { handle: "sfpopupcollective",     venueName: "SF Popup Collective",     tier: "venue" },
  { handle: "lost_resort_sf",        venueName: "The Lost Resort",         tier: "venue" },
  { handle: "holywatersf",           venueName: "Holy Water",              tier: "venue" },
  { handle: "thepawnshopsf",         venueName: "The Pawn Shop",           tier: "venue" },
  { handle: "thelarksf",             venueName: "The Lark",                tier: "venue" },
  { handle: "absinthesf",            venueName: "Absinthe",                tier: "venue" },
  { handle: "theramprestaurant",     venueName: "The Ramp",                tier: "venue" },
  { handle: "beerhallsf",            venueName: "Beer Hall SF",            tier: "venue" },
  { handle: "trickdogbar",           venueName: "Trick Dog",               tier: "venue" },
  { handle: "driftwoodsf",           venueName: "Driftwood",               tier: "venue" },
  { handle: "sf.philosophersclub",   venueName: "Philosophers Club",       tier: "venue" },
  { handle: "oreillyspub_sf",        venueName: "O'Reilly's Pub",          tier: "venue" },
  { handle: "prubechusf",            venueName: "Prubechu",                tier: "venue" },
  { handle: "ravenbarsf",            venueName: "Raven Bar",               tier: "venue" },
  { handle: "horsiesmarketsf",       venueName: "Horsie's Market",         tier: "venue" },

  // ── Community / arts / culture venues ────────────────────────────────────
  { handle: "sfcraftclub",            venueName: "SF Craft Club",           tier: "venue" },
  { handle: "friendsandneighborssf",  venueName: "Friends & Neighbors SF",  tier: "venue" },
  { handle: "drawingroomsf",          venueName: "The Drawing Room SF",     tier: "venue" },
  { handle: "wavecollectivespace",    venueName: "Wave Collective Space",   tier: "venue" },
  { handle: "thefaightsf",            venueName: "The Faight SF",           tier: "venue" },
  { handle: "jfkpianos",              venueName: "JFK Pianos",              tier: "venue" },
  { handle: "therubysf",              venueName: "The Ruby SF",             tier: "venue" },
  { handle: "mrmahjongs",             venueName: "Mr. Mahjong's",           tier: "venue" },

  // ── Community / arts promoters ────────────────────────────────────────────
  { handle: "shapingsf",              venueName: "Shaping San Francisco",   tier: "promoter" },
  { handle: "bird_curious_sf",        venueName: "Bird Curious SF",         tier: "promoter" },
  { handle: "westcoastcraft",         venueName: "West Coast Craft",        tier: "promoter" },
  { handle: "alamedaantiquesfair",    venueName: "Alameda Antiques Fair",   tier: "promoter" },
  { handle: "oaklandvintagemarket",   venueName: "Oakland Vintage Market",  tier: "promoter" },
  { handle: "lowerhaightlocal",       venueName: "Lower Haight Local",      tier: "promoter" },
  { handle: "nowplacesf",             venueName: "Now Place SF",            tier: "promoter" },
  { handle: "moonlitmoves",           venueName: "Moonlit Moves",           tier: "promoter" },
  { handle: "sfdahliasociety",        venueName: "SF Dahlia Society",       tier: "promoter" },
  { handle: "bigbrainsf",             venueName: "Big Brain SF",            tier: "promoter" },
  { handle: "sfbookbesties",          venueName: "SF Book Besties",         tier: "promoter" },
  { handle: "sf.socialclub",          venueName: "SF Social Club",          tier: "promoter" },
  { handle: "curious.connie",         venueName: "Curious Connie",          tier: "promoter" },

  // ── Promoters / DJs / event series (caption-first — use Claude haiku) ────
  { handle: "rinsed.sf",             venueName: "Rinsed SF",               tier: "promoter" },
  { handle: "program.audio",         venueName: "Program Audio",           tier: "promoter" },
  { handle: "darnaevents",           venueName: "DARNA Events",            tier: "promoter" },
  { handle: "freqmusic_art",         venueName: "Freq Music & Art",        tier: "promoter" },
  { handle: "noguestlistsf",         venueName: "No Guest List",           tier: "promoter" },
  { handle: "utopianseries",         venueName: "Utopia Series",           tier: "promoter" },
  { handle: "twoamafters",           venueName: "Two AM Afters",           tier: "promoter" },
  { handle: "ghardghome",            venueName: "Ghard Ghome",             tier: "promoter" },
  { handle: "upward.sf",             venueName: "Upward SF",               tier: "promoter" },
  { handle: "reverb_sf",             venueName: "Reverb SF",               tier: "promoter" },
  { handle: "psychedradiosf",        venueName: "Psych'd Radio",           tier: "promoter" },
  { handle: "clubnightshiftsf",      venueName: "Club Night Shift",        tier: "promoter" },
  { handle: "thatsouttasight",       venueName: "That's Outta Sight",      tier: "promoter" },
  { handle: "sfbikeandbrew",         venueName: "SF Bike & Brew",          tier: "promoter" },
  { handle: "clubcriticalsf",        venueName: "Club Critical",           tier: "promoter" },
];
