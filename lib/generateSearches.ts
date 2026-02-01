/**
 * Google Maps Search Generation Logic
 * Generates unique search queries for a niche across UK locations
 */

// UK Cities - prioritized by population/importance
const UK_CITIES = [
  'London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow',
  'Sheffield', 'Bristol', 'Edinburgh', 'Liverpool', 'Newcastle',
  'Nottingham', 'Leicester', 'Coventry', 'Bradford', 'Cardiff',
  'Belfast', 'Dublin', 'Southampton', 'Portsmouth', 'Oxford',
  'Cambridge', 'York', 'Bath', 'Winchester', 'Canterbury',
  'Exeter', 'Plymouth', 'Brighton', 'Bournemouth', 'Swindon',
  'Reading', 'Slough', 'Watford', 'Luton', 'Peterborough',
  'Derby', 'Stoke-on-Trent', 'Wolverhampton', 'Walsall', 'Dudley',
  'Sandwell', 'Solihull', 'Tamworth', 'Cannock', 'Lichfield',
  'Burton upon Trent', 'Stafford', 'Shrewsbury', 'Telford', 'Hereford',
  'Worcester', 'Gloucester', 'Cheltenham', 'Tewkesbury', 'Stroud',
  'Cirencester', 'Swindon', 'Wantage', 'Abingdon', 'Banbury',
  'Northampton', 'Kettering', 'Wellingborough', 'Corby', 'Daventry',
  'Peterborough', 'Huntingdon', 'Cambridge', 'Ely', 'Wisbech',
  'Norwich', 'Great Yarmouth', 'Lowestoft', 'King\'s Lynn', 'Dereham',
  'Thetford', 'Ipswich', 'Colchester', 'Southend-on-Sea', 'Basildon',
  'Chelmsford', 'Harlow', 'Loughton', 'Romford', 'Dagenham',
  'Barking', 'Ilford', 'Waltham Forest', 'Enfield', 'Haringey',
  'Islington', 'Hackney', 'Tower Hamlets', 'Newham', 'Redbridge',
  'Havering', 'Bexley', 'Greenwich', 'Lewisham', 'Southwark',
  'Lambeth', 'Wandsworth', 'Merton', 'Sutton', 'Croydon',
  'Bromley', 'Hounslow', 'Richmond', 'Kingston', 'Ealing',
  'Hillingdon', 'Harrow', 'Barnet', 'Hertsmere', 'Watford',
  'St Albans', 'Hatfield', 'Welwyn Garden City', 'Stevenage', 'Letchworth',
  'Hitchin', 'Royston', 'Baldock', 'Ashford', 'Maidstone',
  'Sevenoaks', 'Tunbridge Wells', 'Tonbridge', 'Sittingbourne', 'Faversham',
  'Dover', 'Deal', 'Folkestone', 'Hythe', 'Hastings',
  'Bexhill', 'Eastbourne', 'Lewes', 'Newhaven', 'Seaford',
  'Worthing', 'Littlehampton', 'Arundel', 'Chichester', 'Bognor Regis',
  'Selsey', 'Midhurst', 'Petworth', 'Guildford', 'Woking',
  'Aldershot', 'Farnborough', 'Basingstoke', 'Odiham', 'Hook',
  'Farnham', 'Godalming', 'Haslemere', 'Dorking', 'Reigate',
  'Redhill', 'Crawley', 'Horsham', 'Billingshurst', 'Pulborough',
  'Steyning', 'Henfield', 'Burgess Hill', 'Haywards Heath', 'Uckfield',
  'Crowborough', 'Heathfield', 'Hailsham', 'Polegate', 'Ringmer',
]

// UK Counties
const UK_COUNTIES = [
  'Greater London', 'Greater Manchester', 'West Midlands',
  'West Yorkshire', 'Merseyside', 'South Yorkshire',
  'Tyne and Wear', 'Avon', 'Strathclyde', 'Lothian',
  'Tayside', 'Fife', 'Central', 'Grampian', 'Highland',
  'Western Isles', 'Orkney', 'Shetland', 'Dumfries and Galloway',
  'Borders', 'Northumberland', 'Tyne and Wear', 'Durham',
  'Cleveland', 'North Yorkshire', 'Humberside', 'Lincolnshire',
  'Norfolk', 'Suffolk', 'Cambridgeshire', 'Peterborough',
  'Bedfordshire', 'Hertfordshire', 'Essex', 'Greater London',
  'Surrey', 'Sussex', 'Kent', 'Hampshire', 'Isle of Wight',
  'Dorset', 'Somerset', 'Devon', 'Cornwall', 'Wiltshire',
  'Gloucestershire', 'Oxfordshire', 'Berkshire', 'Buckinghamshire',
  'Leicestershire', 'Rutland', 'Nottinghamshire', 'Derbyshire',
  'Staffordshire', 'Shropshire', 'Hereford and Worcester',
  'Warwickshire', 'Northamptonshire', 'Cheshire', 'Lancashire',
  'Cumbria', 'Isle of Man', 'Anglesey', 'Gwynedd', 'Conwy',
  'Denbighshire', 'Flintshire', 'Wrexham', 'Powys', 'Ceredigion',
  'Pembrokeshire', 'Carmarthenshire', 'Swansea', 'Neath Port Talbot',
  'Bridgend', 'Vale of Glamorgan', 'Cardiff', 'Caerphilly',
  'Blaenau Gwent', 'Torfaen', 'Monmouthshire', 'Newport',
  'Antrim', 'Armagh', 'Down', 'Fermanagh', 'Londonderry', 'Tyrone',
]

/**
 * Generate unique Google Maps search queries for a niche
 * @param niche - The business niche (e.g., "roofers", "dentists")
 * @param maxSearches - Target number of searches (default 1000)
 * @param includeCities - Include city-based searches (default true)
 * @param includeCounties - Include county-based searches (default false)
 * @returns Array of unique search strings
 */
export function generateSearches(
  niche: string,
  maxSearches: number = 1000,
  includeCities: boolean = true,
  includeCounties: boolean = false
): string[] {
  // Validate input
  const trimmedNiche = niche.trim().toLowerCase()
  if (trimmedNiche.length < 2 || trimmedNiche.length > 50) {
    throw new Error('Niche must be between 2 and 50 characters')
  }

  // Select locations based on toggles
  const locations: string[] = []
  if (includeCities) {
    locations.push(...UK_CITIES)
  }
  if (includeCounties) {
    locations.push(...UK_COUNTIES)
  }

  if (locations.length === 0) {
    throw new Error('At least one location type must be selected')
  }

  // Generate search variations
  const searches = new Set<string>()

  for (const location of locations) {
    // 10 variations per location to maximize coverage
    searches.add(`${trimmedNiche} in ${location.toLowerCase()}`)
    searches.add(`${location.toLowerCase()} ${trimmedNiche}`)
    searches.add(`best ${trimmedNiche} in ${location.toLowerCase()}`)
    searches.add(`${trimmedNiche} near ${location.toLowerCase()}`)
    searches.add(`${location.toLowerCase()} ${trimmedNiche} services`)
    searches.add(`top ${trimmedNiche} ${location.toLowerCase()}`)
    searches.add(`${trimmedNiche} ${location.toLowerCase()} uk`)
    searches.add(`find ${trimmedNiche} ${location.toLowerCase()}`)
    searches.add(`${trimmedNiche} companies ${location.toLowerCase()}`)
    searches.add(`${location.toLowerCase()} local ${trimmedNiche}`)
  }

  // Validate and filter searches
  const validated: string[] = []
  for (const search of searches) {
    const normalized = search.trim().toLowerCase()

    // Validate: length 6–80 chars
    if (normalized.length < 6 || normalized.length > 80) {
      continue
    }

    // Validate: only alphanumeric, spaces, and hyphens
    if (!/^[a-z0-9\s\-]+$/.test(normalized)) {
      continue
    }

    validated.push(normalized)
  }

  // Deduplicate (case-insensitive)
  const unique = Array.from(new Set(validated))

  // Sort: prioritize major cities first
  unique.sort((a, b) => {
    // Check if search contains a top city (first 20)
    const aHasTopCity = UK_CITIES.slice(0, 20).some((city) =>
      a.includes(city.toLowerCase())
    )
    const bHasTopCity = UK_CITIES.slice(0, 20).some((city) =>
      b.includes(city.toLowerCase())
    )

    if (aHasTopCity && !bHasTopCity) return -1
    if (!aHasTopCity && bHasTopCity) return 1

    // Otherwise sort alphabetically
    return a.localeCompare(b)
  })

  // Truncate to maxSearches
  return unique.slice(0, maxSearches)
}

/**
 * Validate a single search string
 * @param search - Search string to validate
 * @returns true if valid, false otherwise
 */
export function validateSearch(search: string): boolean {
  const normalized = search.trim().toLowerCase()

  // Check length
  if (normalized.length < 6 || normalized.length > 80) {
    return false
  }

  // Check characters (alphanumeric, spaces, hyphens only)
  if (!/^[a-z0-9\s\-]+$/.test(normalized)) {
    return false
  }

  return true
}
