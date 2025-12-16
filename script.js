/* =========================================================
   DIMENSIONS (MAP & CHART)
   ========================================================= */

// Get dimensions of the map container
const mapWidth  = document.querySelector("#map").clientWidth;
const mapHeight = document.querySelector("#map").clientHeight;

// Get dimensions of the chart container
const chartWidth  = document.querySelector("#chart").clientWidth;
const chartHeight = document.querySelector("#chart").clientHeight;


/* =========================================================
   UI STATE (CHECKBOX TOGGLES)
   ========================================================= */

// Read initial checkbox states
let showArrivals     = d3.select("#toggle-arrivals").property("checked");
let showOvernights   = d3.select("#toggle-overnights").property("checked");
let showAverageStays = d3.select("#toggle-averagestays").property("checked");
let showBeds         = d3.select("#toggle-beds").property("checked");
let showWeather      = d3.select("#toggle-weather").property("checked");

// Active weather-related selections
let activeWeatherStation   = null; // Currently selected weather station
let activeWeatherData      = null; // Loaded data for the selected station
let activeWeatherAttribute = null; // Selected weather attribute (e.g. temperature)


/* =========================================================
   SVG STRUCTURE (MAP)
   ========================================================= */

// Create the main SVG inside the map container
const svg = d3.select("#map")
  .append("svg")
  .attr("width", mapWidth)
  .attr("height", mapHeight);

// Root group (used for pan/zoom)
const g = svg.append("g");

// Layer for background map tiles
const tileLayer = g.append("g");

// Layer for geographic features (municipalities, points, etc.)
const mapLayer = g.append("g");

// Tooltip for hover interactions
const tooltip = d3.select("#tooltip");


/* =========================================================
   GEO PROJECTION & PATH
   ========================================================= */

// Mercator projection for the map
const projection = d3.geoMercator();

// Path generator using the projection
const path = d3.geoPath().projection(projection);


/* =========================================================
   DATA STATE
   ========================================================= */

// Tourism data (loaded from CSV)
let tourismData = [];

// Currently selected municipality
let selectedMunicipality = null;

// Set of currently active/visible municipalities
let activeMunicipalities = new Set();


/* =========================================================
   HELPER FUNCTIONS
   ========================================================= */

// Convert a string into a safe CSS class name
// (removes diacritics and special characters)
function safeClassName(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w-]/g, "_");
}


/* =========================================================
   SCALES & CONSTANTS
   ========================================================= */

// Ordinal color scale (used for countries / metrics)
const colorScale = d3.scaleOrdinal([
  "#008B8B",
  "#00c867ff",
  "#1E90FF",
  "#FF0099",
  "#FF4500",
  "#673AB7"
]);


/* =========================================================
   WEATHER STATIONS METADATA
   ========================================================= */

// Static metadata for weather stations
const weatherStations = [
  { id: "bilje",            name: "Bilje",            coords: [13.63517790, 45.89365130], altitude: 52  },
  { id: "hrusica_pri_colu", name: "Hrušica pri Colu", coords: [14.00105020, 45.88117870], altitude: 611 },
  { id: "lokve",            name: "Lokve",            coords: [13.79215750, 46.01214360], altitude: 929 },
  { id: "opatje_selo",      name: "Opatje Selo",      coords: [13.58263280, 45.85130540], altitude: 172 },
  { id: "otlica",           name: "Otlica",           coords: [13.91026180, 45.92766910], altitude: 818 },
  { id: "podraga",          name: "Podraga",          coords: [13.94939380, 45.80669300], altitude: 177 },
  { id: "sela_na_krasu",    name: "Sela na Krasu",    coords: [13.61724750, 45.82120120], altitude: 231 },
  { id: "sempas",           name: "Šempas",           coords: [13.74224410, 45.92853720], altitude: 97  },
  { id: "zalosce",          name: "Zalošče",          coords: [13.74975050, 45.88647330], altitude: 82  }
];


/* =========================================================
   DATA LOADING
   ========================================================= */

Promise.all([
  d3.json("data/geoData/municipalities.geojson"), // Municipality geometries
  d3.csv("data/tourismData/tourism.csv"),             // Tourism indicators
  d3.csv("data/tourismData/beds.csv")                 // Accommodation capacity
]).then(([geo, data, beds]) => {

  /* -------------------------
     PREPROCESS BEDS DATA
     ------------------------- */
  beds.forEach(d => {
    d.Year  = +d.Year;
    d.Beds = +d.Beds;
  });

  bedsData = beds;


  /* -------------------------
     PREPROCESS TOURISM DATA
     ------------------------- */
  data.forEach(d => {
    for (let key in d) {
      if (key !== "Municipality" && key !== "Month") {
        d[key] = +d[key];
      }
    }
  });

  tourismData = data;


  /* -------------------------
     GEO DATA SETUP
     ------------------------- */

  // Automatically detect the municipality name property
  const nameKey = Object.keys(geo.features[0].properties)
    .find(k => /name|naz|ime|obc/i.test(k)) 
    || Object.keys(geo.features[0].properties)[0];

  // Fit the projection to the map size
  const featureCollection = {
    type: "FeatureCollection",
    features: geo.features
  };

  projection.fitSize([mapWidth, mapHeight], featureCollection);


  /* -------------------------
     BACKGROUND MAP TILES
     ------------------------- */

  const tile = d3.tile()
    .size([mapWidth, mapHeight])
    .scale(projection.scale() * 2 * Math.PI)
    .translate(projection([0, 0]));

  const tiles = tile();

  const tileUrl = ([x, y, z]) =>
    `https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/${z}/${x}/${y}.png`;

  tileLayer.selectAll("image")
    .data(tiles)
    .join("image")
    .attr("xlink:href", tileUrl)
    .attr("x", d => (d[0] + tiles.translate[0]) * tiles.scale)
    .attr("y", d => (d[1] + tiles.translate[1]) * tiles.scale)
    .attr("width", tiles.scale)
    .attr("height", tiles.scale);


  /* -------------------------
     METRIC SELECT (DROPDOWN)
     ------------------------- */

  // Extract country names from column headers
  const countries = Array.from(
    new Set(
      data.columns
        .filter(c => c.endsWith("(Arrivals)"))
        .map(c => c.replace(" (Arrivals)", ""))
    )
  ).sort();

  // Populate dropdown
  const select = d3.select("#metric");
  countries.forEach(c =>
    select.append("option")
      .attr("value", c)
      .text(c)
  );

  // Update map & chart when metric changes
  select.on("change", () => {
    updateMap(geo, nameKey);
    updateLineChart();
  });


  /* -------------------------
     TOGGLE EVENTS
     ------------------------- */

  d3.selectAll(
    "#toggle-arrivals, #toggle-overnights, #toggle-averagestays, #toggle-beds, #toggle-weather"
  ).on("change", updateLineChart);


  /* -------------------------
     INITIAL RENDER
     ------------------------- */

  updateMap(geo, nameKey);
  updateLineChart();
});



/* =========================================================
   WEATHER HISTOGRAM
   ========================================================= */

function drawWeatherHistogram(weatherData, attrKey) {
  // Abort if no data is available
  if (!weatherData || weatherData.length === 0) return;

  // Remove existing weather-related elements
  chartG.selectAll(".weather-hist").remove();
  chartG.selectAll(".weather-y-axis").remove();
  chartG.selectAll(".weather-y-label").remove();

  // Do not draw if weather display is disabled
  if (!showWeather) return;

  /* -------------------------
     SCALE SETUP
     ------------------------- */

  // Set Y-domain with padding for better readability
  weatherY.domain([
    0,
    d3.max(weatherData, d => d[attrKey]) * 1.15
  ]);

  /* -------------------------
     HISTOGRAM BARS
     ------------------------- */

  const barLayer = chartG
    .append("g")
    .attr("class", "weather-hist");

  barLayer.selectAll("rect")
    .data(weatherData)
    .join("rect")
    .attr("x", d => xScale(d.Month))
    .attr("width", xScale.bandwidth())
    .attr("y", d => weatherY(d[attrKey]))
    .attr("height", d => innerHeight - weatherY(d[attrKey]))
    .attr("fill", "rgba(0, 140, 255, 0.2)")
    .attr("stroke-width", 1.2)
    .lower(); // Send bars behind line charts


  /* -------------------------
     WEATHER AXIS
     ------------------------- */

  const weatherAxis = d3.axisRight(weatherY).ticks(6);

  // Axis label text
  const weatherAxisLabel =
    `${attrKey} - Weather Station ${activeWeatherStation?.name ?? ""}`;

  // Adjust axis position when multiple right axes are visible
  rightAxisShift  = showAverageStays ? 60 : 0;
  rightLabelShift = showAverageStays ? 100 : 50;

  // Draw right Y-axis
  chartG.append("g")
    .attr("class", "weather-y-axis")
    .attr("transform", `translate(${innerWidth + rightAxisShift}, 0)`)
    .call(weatherAxis)
    .call(g => {
      g.selectAll("path").attr("stroke", "skyblue");
      g.selectAll("line").attr("stroke", "skyblue");
      g.selectAll("text").attr("fill", "skyblue");
    });

  // Draw axis label
  chartG.append("text")
    .attr("class", "weather-y-label")
    .attr(
      "transform",
      `translate(${innerWidth + rightLabelShift}, ${innerHeight / 2}) rotate(90)`
    )
    .attr("text-anchor", "middle")
    .style("font-size", "14px")
    .style("fill", "skyblue")
    .text(weatherAxisLabel);
}


/* =========================================================
   MAP UPDATE (MUNICIPALITIES & WEATHER STATIONS)
   ========================================================= */

function updateMap(geo, nameKey) {

  /* -------------------------
     CLEANUP
     ------------------------- */

  // Remove old municipality labels
  mapLayer.selectAll(".label").remove();


  /* -------------------------
     MUNICIPALITY SHAPES
     ------------------------- */

  mapLayer.selectAll("path")
    .data(geo.features)
    .join("path")
    .attr("d", path)
    .attr("fill", d => {
      const name = d.properties[nameKey];
      return activeMunicipalities.has(name)
        ? colorScale(name)
        : "#e0e0e003";
    })
    .attr("stroke", "#333")
    .attr("stroke-width", 1)
    .style("cursor", "pointer")

    // Toggle municipality on click
    .on("click", (event, d) => {
      const name = d.properties[nameKey];
      activeMunicipalities.has(name)
        ? activeMunicipalities.delete(name)
        : activeMunicipalities.add(name);

      updateMap(geo, nameKey);
      updateLineChart();
    })

    // Highlight municipality on hover
    .on("mouseenter", (event, d) => {
      const name = d.properties[nameKey];
      if (!activeMunicipalities.has(name)) {
        d3.select(event.currentTarget)
          .attr("fill", "#e0e0e09d");
      }
    })

    .on("mouseleave", (event, d) => {
      const name = d.properties[nameKey];
      if (!activeMunicipalities.has(name)) {
        d3.select(event.currentTarget)
          .attr("fill", "#e0e0e003");
      }
    });


  /* -------------------------
     MUNICIPALITY LABELS
     ------------------------- */

  geo.features.forEach(d => {
    const centroid = path.centroid(d);
    const name = d.properties[nameKey];

    const labelGroup = mapLayer.append("g")
      .attr("class", "label")
      .attr("transform", `translate(${centroid[0]}, ${centroid[1]})`)
      .style("cursor", "pointer");

    const textEl = labelGroup.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("font-size", "12px")
      .attr("font-family", "Aptos, sans-serif")
      .attr("fill", "black")
      .text(name);

    // Background rectangle for text readability
    const bbox = textEl.node().getBBox();
    labelGroup.insert("rect", "text")
      .attr("x", bbox.x - 4)
      .attr("y", bbox.y - 3)
      .attr("width", bbox.width + 8)
      .attr("height", bbox.height + 6)
      .attr("fill", "#ffffffc6")
      .style("pointer-events", "none");

    // Toggle municipality by clicking the label
    labelGroup.on("click", () => {
      activeMunicipalities.has(name)
        ? activeMunicipalities.delete(name)
        : activeMunicipalities.add(name);

      updateMap(geo, nameKey);
      updateLineChart();
    });
  });


  /* -------------------------
     WEATHER STATIONS
     ------------------------- */

  // Remove existing station nodes
  mapLayer.selectAll(".weather-station").remove();

  const stationNodes = mapLayer.selectAll(".weather-station")
    .data(weatherStations)
    .join("circle")
    .attr("class", "weather-station")
    .attr("cx", d => projection(d.coords)[0])
    .attr("cy", d => projection(d.coords)[1])
    .attr("r", d => activeWeatherStation?.id === d.id ? 6 : 4)
    .attr("fill", d => activeWeatherStation?.id === d.id ? "black" : "white")
    .attr("stroke", "black")
    .attr("stroke-width", 1)
    .style("cursor", "pointer");

  // Hover interaction + tooltip
  stationNodes
    .on("mouseenter", function (event, d) {
      if (activeWeatherStation?.id !== d.id) {
        d3.select(this).attr("r", 6);
      }

      tooltip
        .style("display", "block")
        .style("left", `${event.pageX + 10}px`)
        .style("top", `${event.pageY - 10}px`)
        .html(`${d.name} (${d.altitude} m)`);
    })

    .on("mouseleave", function (event, d) {
      if (activeWeatherStation?.id !== d.id) {
        d3.select(this).attr("r", 4);
      }
      tooltip.style("display", "none");
    })

    // Click interaction: activate / deactivate station
    .on("click", async function (event, d) {

      // Deactivate station if already selected
      if (activeWeatherStation?.id === d.id) {
        activeWeatherStation  = null;
        activeWeatherData     = null;
        activeWeatherAttribute = null;

        stationNodes
          .attr("r", 4)
          .attr("fill", "white");

        chartG.selectAll(".weather-hist").remove();
        chartG.selectAll(".weather-y-axis").remove();
        chartG.selectAll(".weather-y-label").remove();

        d3.select("#weather-attr-select").style("display", "none");
        d3.select("#weather-attr-select-label").style("display", "none");
        d3.select("#label-weather").style("display", "none");

        return;
      }

      /* -------------------------
         ACTIVATE STATION
         ------------------------- */

      // Force-enable weather toggle
      d3.select("#toggle-weather").property("checked", true);
      showWeather = true;

      activeWeatherStation = d;

      stationNodes
        .attr("r", s => activeWeatherStation?.id === s.id ? 6 : 4)
        .attr("fill", s => activeWeatherStation?.id === s.id ? "black" : "white");

      // Load station CSV data
      const weatherData = await loadWeatherCSV(d);
      if (!weatherData) return;

      // Populate attribute dropdown
      populateWeatherDropdown(weatherData);

      // Draw default attribute
      const defaultAttr = weatherAttributes[0];
      drawWeatherHistogram(weatherData, defaultAttr);

      activeWeatherData      = weatherData;
      activeWeatherAttribute = defaultAttr;

      tooltip.style("display", "none");
    });
}


/* =========================================================
   WEATHER CSV LOADER
   ========================================================= */

async function loadWeatherCSV(station) {

  // Resolve file name (explicit or derived from station id)
  const fileName = station.file ?? `${station.id}.csv`;
  const url = `data/weatherData/${fileName}`;

  try {
    const data = await d3.csv(url);
    if (!data || data.length === 0) return null;

    data.forEach(d => {

      // Normalize month column
      if (d.month) {
        d.Month = d.month.replace("/", "M");
      } else {
        console.warn("CSV row missing `month`:", d);
        d.Month = null;
      }

      // Convert numeric values
      for (let key in d) {
        if (
          key !== "station name" &&
          key !== "month" &&
          key !== "Month" &&
          !isNaN(+d[key])
        ) {
          d[key] = +d[key];
        }
      }
    });

    return data;

  } catch (err) {
    console.error("Failed to load weather CSV:", err);
    return null;
  }
}



/* =========================================================
   WEATHER ATTRIBUTE SELECTION
   ========================================================= */

// List of numeric weather attributes available in the dataset
let weatherAttributes = [];


/**
 * Populate the weather attribute dropdown
 * @param {Array<Object>} weatherData - Parsed CSV data for a weather station
 */
function populateWeatherDropdown(weatherData) {

  // Extract numeric columns from the first row
  const numericKeys = Object.keys(weatherData[0]).filter(
    k => typeof weatherData[0][k] === "number"
  );

  // Store available attributes globally
  weatherAttributes = numericKeys;


  /* -------------------------
     DROPDOWN LABEL
     ------------------------- */

  const label = d3.select("#weather-attr-select-label");
  label.style("display", "inline-block");


  /* -------------------------
     DROPDOWN SELECT
     ------------------------- */

  const sel = d3.select("#weather-attr-select");
  sel.style("display", "inline-block");

  // Remove existing options
  sel.selectAll("option").remove();

  // Add new options
  sel.selectAll("option")
    .data(numericKeys)
    .join("option")
    .attr("value", d => d)
    .text(d => d);

  // Redraw histogram when attribute changes
  sel.on("change", () => {
    const attr = sel.property("value");
    drawWeatherHistogram(weatherData, attr);
  });


  /* -------------------------
     SECONDARY WEATHER LABEL
     ------------------------- */

  const label2 = d3.select("#label-weather");
  label2.style("display", "inline-block");
}


/* =========================================================
   WEATHER HISTOGRAM (DISTRIBUTION)
   ========================================================= */

/**
 * Update the histogram showing value distribution
 * of the currently selected weather attribute
 */
function updateWeatherHistogram() {

  // Remove previous histogram
  chartG.selectAll(".weather-hist").remove();

  // Abort if no active weather state
  if (!activeWeatherData || !activeWeatherAttribute) return;

  /* -------------------------
     DATA PREPARATION
     ------------------------- */

  // Extract numeric values and filter invalid entries
  const data = activeWeatherData
    .map(d => +d[activeWeatherAttribute])
    .filter(v => !isNaN(v));


  /* -------------------------
     SCALES
     ------------------------- */

  // X-scale for value range
  const x = d3.scaleLinear()
    .domain([d3.min(data), d3.max(data)])
    .range([0, innerWidth]);

  // Create histogram bins
  const bins = d3.bin()
    .thresholds(12)(data);

  // Y-scale for bin counts
  const y = d3.scaleLinear()
    .domain([0, d3.max(bins, b => b.length)])
    .range([innerHeight, 0]);


  /* -------------------------
     HISTOGRAM BARS
     ------------------------- */

  const histLayer = chartG
    .insert("g", ":first-child")
    .attr("class", "weather-hist");

  histLayer.selectAll("rect")
    .data(bins)
    .join("rect")
    .attr("x", d => x(d.x0))
    .attr("y", d => y(d.length))
    .attr("width", d => Math.max(0, x(d.x1) - x(d.x0) - 1))
    .attr("height", d => innerHeight - y(d.length))
    .attr("fill", "rgba(0, 123, 255, 0.25)");
}


/* =========================================================
   CHART SVG & LAYOUT
   ========================================================= */

// Create SVG container for the chart
const chartSvg = d3.select("#chart")
  .append("svg")
  .attr("width", chartWidth)
  .attr("height", chartHeight);

// Margins for the chart area
let margin = {
  top: 30,
  right: 130,
  bottom: 100,
  left: 100
};

// Inner chart dimensions
const innerWidth  = chartWidth  - margin.left - margin.right;
const innerHeight = chartHeight - margin.top  - margin.bottom;

// Main chart group
const chartG = chartSvg.append("g")
  .attr("transform", `translate(${margin.left}, ${margin.top})`);


/* =========================================================
   SCALES
   ========================================================= */

// X-scale for categorical months
const xScale = d3.scaleBand()
  .padding(0.2);

// Y-scale for tourism metrics
const yScale = d3.scaleLinear();

// Y-scale for average stays (secondary axis)
const yAvgScale = d3.scaleLinear()
  .range([innerHeight, 0]);

// Y-scale for weather values
const weatherY = d3.scaleLinear()
  .range([innerHeight, 0]);


/* =========================================================
   CHART TOOLTIP
   ========================================================= */

// Tooltip used inside the chart area
const chartTooltip = d3.select("body")
  .append("div")
  .attr("class", "tooltip")
  .style("display", "none");


/* =========================================================
   BACKGROUND INTERACTION LAYER
   ========================================================= */

// Transparent rectangle to capture clicks and clear interactions
chartG.append("rect")
  .attr("class", "bg-rect")
  .attr("width", innerWidth)
  .attr("height", innerHeight)
  .attr("fill", "transparent")
  .style("pointer-events", "all")
  .on("click", () => {
    chartTooltip.style("display", "none");
    chartG.selectAll(".brush")
      .call(d3.brushX().clear);
  });


/* =========================================================
   UTILITY FUNCTIONS
   ========================================================= */

/**
 * Get the pixel center of a month band
 * @param {string} m - Month key
 * @param {d3.ScaleBand} xScale - Band scale for months
 * @returns {number} X coordinate of the band center
 */
function monthCenterPx(m, xScale) {
  return xScale(m) + xScale.bandwidth() / 2;
}


function updateLineChart() {
  // Read selected country/metric from dropdown
  const country = d3.select("#metric").property("value");

  // Read toggle states for individual data layers
  showArrivals = d3.select("#toggle-arrivals").property("checked");
  showOvernights = d3.select("#toggle-overnights").property("checked");
  showAverageStays = d3.select("#toggle-averagestays").property("checked");
  showBeds = d3.select("#toggle-beds").property("checked");
  showWeather = d3.select("#toggle-weather").property("checked");

  // Hide tooltip whenever the chart is redrawn
  chartTooltip.style("display", "none");

  // Remove all existing chart elements except:
  // - background rectangle
  // - weather histogram
  // - weather y-axis and its label
  chartG
    .selectAll(
      "*:not(.bg-rect):not(.weather-hist):not(.weather-y-axis):not(.weather-y-label)"
    )
    .remove();

  // Ensure correct layering (z-order) of weather-related elements
  chartG.selectAll('.weather-hist').lower();   // send histogram to background
  chartG.selectAll('.weather-y-axis').raise(); // keep axis visible
  chartG.selectAll('.weather-y-label').raise();// keep label on top

  // (Re)draw weather histogram depending on toggle state
  drawWeatherHistogram(activeWeatherData, activeWeatherAttribute, showWeather);

  // Get currently selected municipalities
  const selected = Array.from(activeMunicipalities);

  // Container for tourism datasets (one per municipality or aggregated)
  let datasets = [];

  // Abort if tourism data is missing or empty
  if (!tourismData || tourismData.length === 0) return;

  // CASE 1: No municipality selected → aggregate all municipalities together
  if (selected.length === 0) {
    // Extract all unique months and sort them chronologically
    const allMonths = Array.from(new Set(tourismData.map(d => d.Month)))
      .sort(d3.ascending);

    // Remove the first month (often incomplete or used as baseline)
    allMonths.shift();

    // Construct dynamic column names based on selected country
    const keyArr = `${country} (Arrivals)`;
    const keyOver = `${country} (Overnight stays)`;

    // Sum arrivals and overnight stays across all municipalities per month
    const monthlySum = allMonths.map(m => {
      const rows = tourismData.filter(d => d.Month === m);
      const totalArr = d3.sum(rows, r => r[keyArr]);
      const totalOver = d3.sum(rows, r => r[keyOver]);

      return {
        Municipality: "All Municipalities Combined",
        Month: m,
        Arrivals: totalArr,
        Overnights: totalOver,
        // Average stay = overnight stays divided by arrivals
        AverageStay: totalArr ? (totalOver / totalArr) : 0
      };
    });

    datasets.push(monthlySum);

  // CASE 2: One or more municipalities selected → process each separately
  } else {
    selected.forEach(m => {
      const keyArr = `${country} (Arrivals)`;
      const keyOver = `${country} (Overnight stays)`;

      // Filter tourism data for the selected municipality (case-insensitive)
      const muniData = tourismData
        .filter(d => d.Municipality.trim().toLowerCase() === m.trim().toLowerCase())
        .sort((a, b) => d3.ascending(a.Month, b.Month));

      // Map raw rows into a normalized structure used by the chart
      datasets.push(
        muniData.map(d => ({
          Municipality: m,
          Month: d.Month,
          Arrivals: d[keyArr],
          Overnights: d[keyOver],
          AverageStay: d[keyArr] ? (d[keyOver] / d[keyArr]) : 0
        }))
      );
    });
  }

  // Extract all unique months for x-axis scale and ticks
  const months = Array.from(new Set(tourismData.map(d => d.Month)))
    .sort(d3.ascending);

  // Remove first month for consistency with datasets
  months.shift();

  // Use every 12th month as a year tick (e.g. January)
  const yearTicks = months.filter((d, i) => i % 12 === 0);

  // Extract unique years from month strings (format: YYYYMx)
  const years = Array.from(
    new Set(months.map(d => +d.split("M")[0]))
  );

  // Container for bed-capacity datasets
  let bedDatasets = [];

  // CASE 1: No municipality selected → sum beds across all municipalities per year
  if (selected.length === 0) {
    const yearlySum = years.map(y => {
      const rows = bedsData.filter(d => d.Year === y);
      return {
        Municipality: "All Municipalities Combined",
        Year: y,
        Beds: d3.sum(rows, r => r.Beds)
      };
    });

    bedDatasets.push(yearlySum);

  // CASE 2: Municipality selection → keep bed data separate per municipality
  } else {
    selected.forEach(m => {
      const rows = bedsData
        .filter(d => d.Municipality === m)
        .sort((a, b) => d3.ascending(a.Year, b.Year));

      bedDatasets.push(
        rows.map(d => ({
          Municipality: m,
          Year: d.Year,
          Beds: d.Beds
        }))
      );
    });
  }


  /* =========================
     SCALE DOMAINS
     ========================= */

  // Define x-scale domain using all available months
  xScale.domain(months).range([0, innerWidth]);

  // Find maximum value among arrivals and overnight stays
  const maxArrOver = d3.max(
    datasets.flat(),
    d => Math.max(d.Arrivals, d.Overnights)
  );

  // Find maximum number of beds (yearly data)
  const maxBeds = d3.max(
    bedDatasets.flat(),
    d => d.Beds
  );

  // Use the larger of tourism values and bed capacity
  // Add 10% padding for visual spacing
  const yMax = Math.max(maxArrOver, maxBeds) * 1.1;

  // Configure main y-scale (arrivals / overnights / beds)
  yScale
    .domain([0, yMax])
    .range([innerHeight, 0]);

  // Find maximum average stay value
  const maxAvgStay = d3.max(
    datasets.flat(),
    d => d.AverageStay
  );

  // Configure secondary y-scale for average stay
  // Add 20% padding to avoid clipping
  yAvgScale.domain([0, maxAvgStay * 1.2]);


  /* =========================
     AXES
     ========================= */

  // Create a dedicated group for axes
  const axesLayer = chartG.append("g").attr("class", "axes");

  // X-axis (months)
  axesLayer.append("g")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(
      d3.axisBottom(xScale)
        // Show every third month to avoid label clutter
        .tickValues(months.filter((d, i) => i % 3 === 0))
        .tickFormat(d => {
          const [year, month] = d.split("M");
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          return monthNames[+month - 1];
        })
    );

  // Left y-axis for arrivals / overnights / beds
  axesLayer.append("g")
    .call(d3.axisLeft(yScale).ticks(6));

  // Right y-axis for average stay (only if enabled)
  if (showAverageStays) {
    axesLayer.append("g")
      .attr("transform", `translate(${innerWidth},0)`)
      .call(d3.axisRight(yAvgScale).ticks(6));

    // Label for secondary y-axis
    chartG.append("text")
      .attr("class", "axis-label")
      .attr("transform",
        `translate(${innerWidth + 30}, ${innerHeight / 2}) rotate(90)`)
      .attr("text-anchor", "middle")
      .text("Average stay (nights)");
  }


  /* =========================
     AXIS LABELS
     ========================= */

  // X-axis label
  chartG.append("text")
    .attr("class", "axis-label")
    .attr("x", innerWidth / 2)
    .attr("y", innerHeight + 45)
    .attr("text-anchor", "middle")
    .text("Month");

  // Left y-axis label
  chartG.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerHeight / 2)
    .attr("y", -60)
    .attr("text-anchor", "middle")
    .text("Number of Arrivals / Overnights / Beds");


  /* =========================
     GRIDLINES
     ========================= */

  // Horizontal gridlines based on y-scale ticks
  chartG.append("g")
    .call(g => g.selectAll("line.grid")
      .data(yScale.ticks(6))
      .join("line")
      .attr("class", "grid")
      .attr("x1", 0)
      .attr("x2", innerWidth)
      .attr("y1", d => yScale(d))
      .attr("y2", d => yScale(d))
      .attr("stroke", "#e5e5e5ff"));

  // Vertical gridlines marking the start of each year
  chartG.append("g")
    .attr("class", "vertical-grid")
    .selectAll("line")
    .data(yearTicks)
    .join("line")
    .attr("x1", d => xScale(d) + xScale.bandwidth() / 2)
    .attr("x2", d => xScale(d) + xScale.bandwidth() / 2)
    .attr("y1", 0)
    .attr("y2", innerHeight)
    .attr("stroke", "#e5e5e5ff")
    .attr("stroke-width", 1);

  // Year labels above the chart
  chartG.append("g")
    .attr("class", "year-labels")
    .selectAll("text")
    .data(yearTicks)
    .join("text")
    .attr("x", d => xScale(d) + xScale.bandwidth() / 2 + 78)
    .attr("y", -6)
    .attr("text-anchor", "middle")
    .attr("font-size", "12px")
    .attr("font-weight", "500")
    .attr("fill", "#d7d7d7ff")
    .text(d => d.split("M")[0]);


  /* =========================
     LINE GENERATORS
     ========================= */

  // Line for arrivals
  const lineArr = d3.line()
    .x(d => xScale(d.Month) + xScale.bandwidth() / 2)
    .y(d => yScale(d.Arrivals));

  // Line for overnight stays
  const lineOver = d3.line()
    .x(d => xScale(d.Month) + xScale.bandwidth() / 2)
    .y(d => yScale(d.Overnights));

  // Line for average stay (secondary y-axis)
  const lineAvg = d3.line()
    .x(d => xScale(d.Month) + xScale.bandwidth() / 2)
    .y(d => yAvgScale(d.AverageStay));


  /* =========================
     PLOTTING DATA LAYERS
     ========================= */

  // Main layer that holds all line and point elements
  const plotLayer = chartG.append("g").attr("class", "plot-layer");

  // Map used later for legend construction (metric type → label)
  const metricMap = new Map();

  // Loop over each dataset (one per municipality or aggregated)
  datasets.forEach(data => {
    const muni = data[0].Municipality;
    const safe = safeClassName(muni); // CSS-safe class name
    const color = muni === "All Municipalities Combined"
      ? "black"
      : colorScale(muni);

    /* ---------- ARRIVALS ---------- */
    if (showArrivals) {
      // Register metric for legend
      metricMap.set("filled", { label: "Arrivals", type: "filled" });

      // Draw arrivals line
      plotLayer.append("path")
        .datum(data)
        .attr("class", "line-arr " + safe)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 1.5)
        .attr("d", lineArr);

      // Draw arrivals data points
      plotLayer.selectAll(".dot-arr-" + safe)
        .data(data)
        .join("circle")
        .attr("class", "dot-arr-" + safe)
        .attr("cx", d => xScale(d.Month) + xScale.bandwidth() / 2)
        .attr("cy", d => yScale(d.Arrivals))
        .attr("r", 3)
        .attr("fill", color);
    }

    /* ---------- OVERNIGHT STAYS ---------- */
    if (showOvernights) {
      // Register metric for legend
      metricMap.set("hollow", { label: "Overnights", type: "hollow" });

      // Draw overnight stays line (dashed)
      plotLayer.append("path")
        .datum(data)
        .attr("class", "line-over " + safe)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "4,2")
        .attr("d", lineOver);

      // Draw hollow dots for overnight stays
      plotLayer.selectAll(".dot-over-" + safe)
        .data(data)
        .join("circle")
        .attr("class", "dot-over-" + safe)
        .attr("cx", d => xScale(d.Month) + xScale.bandwidth() / 2)
        .attr("cy", d => yScale(d.Overnights))
        .attr("r", 3)
        .attr("fill", "#fafafa")
        .attr("stroke", color)
        .attr("stroke-width", 2)
        .style("pointer-events", "all");
    }

    /* ---------- AVERAGE STAY ---------- */
    if (showAverageStays) {
      // Register metric for legend
      metricMap.set("avg", { label: "Average stay", type: "avg" });

      // Draw average stay line (secondary y-axis)
      plotLayer.append("path")
        .datum(data)
        .attr("class", "line-avg " + safe)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "2,2")
        .attr("opacity", 0.8)
        .attr("d", lineAvg);

      // Triangle symbol for average stay points
      const avgSymbol = d3.symbol()
        .type(d3.symbolTriangle)
        .size(40);

      plotLayer.selectAll(".dot-avg-" + safe)
        .data(data)
        .join("path")
        .attr("class", "dot-avg-" + safe)
        .attr("d", avgSymbol)
        .attr(
          "transform",
          d => `translate(${xScale(d.Month) + xScale.bandwidth() / 2}, ${yAvgScale(d.AverageStay)})`
        )
        .attr("fill", color);
    }

    /* ---------- BEDS (YEARLY BARS) ---------- */
    if (showBeds) {
      // Register metric for legend
      metricMap.set("bar", { label: "Beds (yearly)", type: "bar" });

      // Separate layer for bed bars (kept behind lines)
      const bedsLayer = chartG.append("g")
        .attr("class", "beds-layer");

      const bedGroupsCount = bedDatasets.length;

      // Sort bed datasets by total capacity for consistent ordering
      bedDatasets.sort(
        (a, b) => d3.sum(a, d => d.Beds) - d3.sum(b, d => d.Beds)
      );

      // Draw grouped bars for each year
      years.forEach(year => {
        const yearStart = `${year}M01`;
        const xStart = xScale(yearStart);
        if (xStart === undefined) return;

        // Total width covering all months of the year
        const yearWidth = (xScale.bandwidth() + 2) * 12;
        const barWidth = yearWidth / bedGroupsCount;

        bedDatasets.forEach((dataset, i) => {
          const entry = dataset.find(d => d.Year === year);
          if (!entry) return;

          const muni = entry.Municipality;
          const color = muni === "All Municipalities Combined"
            ? "rgba(120,120,120,0.35)"
            : d3.color(colorScale(muni)).copy({ opacity: 0.4 });

          bedsLayer.append("rect")
            .attr("class", "bed-bar " + safeClassName(muni))
            .attr("x", 5 + xStart + i * barWidth)
            .attr("width", barWidth)
            .attr("y", yScale(entry.Beds))
            .attr("height", innerHeight - yScale(entry.Beds))
            .attr("fill", color);
        });
      });

      // Ensure bars stay behind lines and points
      bedsLayer.lower();
    }
  });



  /* =========================
     TITLE
     ========================= */

  // Chart title (can later be made dynamic based on filters)
  let titleText = "Tourist Arrivals and Overnights in the Vipava Valley Municipalities";

  d3.select("#chart-title").text(titleText);


  /* =========================
     MUNICIPALITY LEGEND
     ========================= */

  // Legend group for municipalities (color-coded)
  const legend = chartG.append("g")
    .attr("class", "legend-municipalities")
    .attr("transform", `translate(20, 0)`);

  // Prepare legend data from datasets
  const legendData = datasets.map(d => ({
    label: d[0].Municipality,
    color: d[0].Municipality === "All Municipalities Combined"
      ? "#264653"
      : colorScale(d[0].Municipality)
  }));

  const muniRowHeight = 22;

  // Create one legend row per municipality
  const muniLegend = legend.selectAll("g.row")
    .data(legendData)
    .join("g")
    .attr("class", "row")
    .attr("transform", (d, i) => `translate(0, ${i * muniRowHeight})`);

  // Colored square symbol
  muniLegend.append("rect")
    .attr("width", 14)
    .attr("height", 14)
    .attr("rx", 3)
    .attr("ry", 3)
    .attr("fill", d => d.color);

  // Municipality label
  muniLegend.append("text")
    .attr("x", 20)
    .attr("y", 11)
    .text(d => d.label)
    .style("font-size", "12px")
    .style("fill", "#333");


  /* =========================
     METRIC LEGEND
     ========================= */

  // Legend group for metric types (arrivals, overnights, average stay, beds)
  const metricLegend = chartG.append("g")
    .attr("class", "legend-metrics")
    .attr("transform",
      `translate(20, ${legendData.length * muniRowHeight + 10})`
    );

  const metricRowHeight = 20;

  // Convert metricMap to array (unique metric definitions)
  const metrics = Array.from(metricMap.values());

  // Create legend rows for each metric
  const metricRows = metricLegend.selectAll("g.row")
    .data(metrics)
    .join("g")
    .attr("class", "row")
    .attr("transform", (d, i) => `translate(0, ${i * metricRowHeight})`);

  // Filled circle → Arrivals
  metricRows
    .filter(d => d.type === "filled")
    .append("circle")
    .attr("cx", 7)
    .attr("cy", 7)
    .attr("r", 5)
    .attr("fill", "#555");

  // Hollow circle → Overnight stays
  metricRows
    .filter(d => d.type === "hollow")
    .append("circle")
    .attr("cx", 7)
    .attr("cy", 7)
    .attr("r", 5)
    .attr("fill", "white")
    .attr("stroke", "#555")
    .attr("stroke-width", 1.5);

  // Rectangle → Beds (bars)
  metricRows
    .filter(d => d.type === "bar")
    .append("rect")
    .attr("x", 2)
    .attr("y", 2)
    .attr("width", 10)
    .attr("height", 10)
    .attr("fill", "#aaa");

  // Metric label text
  metricRows.append("text")
    .attr("x", 20)
    .attr("y", 10)
    .text(d => d.label)
    .style("font-size", "12px")
    .style("fill", "#333");

  // Triangle symbol → Average stay
  metricRows
    .filter(d => d.type === "avg")
    .append("path")
    .attr("d", d3.symbol().type(d3.symbolTriangle).size(60))
    .attr("transform", "translate(7,7)")
    .attr("fill", "#555");


  /* =========================
     BRUSH (TIME RANGE SELECTION)
     ========================= */

  // Layer for brush interaction
  const brushG = chartG.append("g").attr("class", "brush");

  // Horizontal brush for selecting a time range
  const brush = d3.brushX()
    .extent([[0, 0], [innerWidth, innerHeight]])
    .on("start", () => {
      // Enable pointer events only while brushing
      brushG.style("pointer-events", "all");
    })
    .on("end", brushed);

  // Attach brush to its layer
  brushG.call(brush);

  // Disable pointer events by default (prevents accidental brushing)
  brushG.style("pointer-events", "none");


  /* =========================
     HELPERS
     ========================= */

  // Format month strings (e.g. "2022M03") into readable labels
  function formatMonthLabel(d) {
    const [year, month] = d.split("M");
    return d3.timeFormat("%b %Y")(new Date(year, month - 1));
  }




  /* =========================================================
    SUMMARY TOOLTIP HTML GENERATOR
    ========================================================= */

  /**
   * Generate HTML content for the chart tooltip
   * based on aggregated municipality summaries and
   * enabled display options.
   *
   * @param {Array<Object>} summaries - Aggregated data per municipality
   * @param {string} periodText - Human-readable time range label
   * @param {Object} options - Display toggles
   * @param {boolean} options.showArrivals
   * @param {boolean} options.showOvernights
   * @param {boolean} options.showAverageStays
   * @param {boolean} options.showBeds
   * @returns {string} HTML string for tooltip content
   */
  function generateSummaryHTML(summaries, periodText, options) {

    // Destructure display options
    const {
      showArrivals,
      showOvernights,
      showAverageStays,
      showBeds
    } = options;


    /* -------------------------
      HTML CONSTRUCTION
      ------------------------- */

    const html = `
      <strong>Period:</strong> ${periodText}<br>
      ${summaries.map(s => {

        // Start section for one municipality
        const lines = [
          `<hr><strong>${s.muni}</strong><br>`
        ];

        // Arrivals
        if (showArrivals) {
          lines.push(
            `Arrivals: ${s.sumArr.toLocaleString()}<br>`
          );
        }

        // Overnights
        if (showOvernights) {
          lines.push(
            `Overnights: ${s.sumOver.toLocaleString()}<br>`
          );
        }

        // Average length of stay
        if (showAverageStays) {
          lines.push(
            `Average stay: ${s.avgStay.toFixed(2)} nights<br>`
          );
        }

        // Beds per year
        if (showBeds) {
          lines.push(
            `Beds: ${s.bedsByYear
              .map(b => `${b.beds.toLocaleString()} (${b.year})`)
              .join(", ")}<br>`
          );
        }

        // Combine all lines for this municipality
        return lines.join("");

      }).join("")}
    `;

    return html;
  }


  /* =========================================================
    BRUSH HANDLER (CHART SELECTION)
    ========================================================= */

  /**
   * Handle brush selection on the chart
   * Calculates aggregated values for the selected time range
   * and displays them in a tooltip.
   */
  function brushed(event) {

    /* -------------------------
      BRUSH SELECTION
      ------------------------- */

    const selection = event.selection;

    // Hide tooltip if brush is cleared
    if (!selection) {
      chartTooltip.style("display", "none");
      return;
    }


    /* -------------------------
      FIND SELECTED MONTHS
      ------------------------- */

    // Determine which months fall inside the brushed pixel range
    const indices = months.filter(m => {
      const px = monthCenterPx(m, xScale);
      return px >= selection[0] && px <= selection[1];
    });

    // Abort if no months are selected
    if (indices.length === 0) {
      chartTooltip.style("display", "none");
      return;
    }


    /* -------------------------
      SELECTED YEARS
      ------------------------- */

    // Extract unique years from selected months
    const selectedYears = Array.from(
      new Set(indices.map(d => +d.split("M")[0]))
    ).sort(d3.ascending);


    /* -------------------------
      DATA AGGREGATION
      ------------------------- */

    const summaries = datasets.map(ds => {

      const muni = ds[0].Municipality;

      // Filter dataset to selected months
      const sub = ds.filter(d => indices.includes(d.Month));

      // Aggregate arrivals and overnights
      const sumArr  = d3.sum(sub, d => d.Arrivals);
      const sumOver = d3.sum(sub, d => d.Overnights);

      // Calculate average stay length
      const avgStay = sumArr ? (sumOver / sumArr) : 0;


      /* -------------------------
        BEDS BY YEAR
        ------------------------- */

      let bedsByYear = [];

      // Special handling for aggregated municipality
      if (muni === "All Municipalities Combined") {

        bedsByYear = selectedYears.map(y => ({
          year: y,
          beds: d3.sum(
            bedsData.filter(d => d.Year === y),
            d => d.Beds
          )
        }));

      } else {

        bedsByYear = selectedYears.map(y => {
          const row = bedsData.find(
            d => d.Municipality === muni && d.Year === y
          );

          return {
            year: y,
            beds: row ? row.Beds : 0
          };
        });
      }

      return {
        muni,
        sumArr,
        sumOver,
        avgStay,
        bedsByYear
      };
    });


    /* -------------------------
      PERIOD LABEL
      ------------------------- */

    const startLabel = formatMonthLabel(indices[0]);
    const endLabel   = formatMonthLabel(indices[indices.length - 1]);

    const periodText =
      startLabel === endLabel
        ? startLabel
        : `${startLabel} – ${endLabel}`;


    /* -------------------------
      TOOLTIP CONTENT
      ------------------------- */

    const html = generateSummaryHTML(
      summaries,
      periodText,
      {
        showArrivals,
        showOvernights,
        showAverageStays,
        showBeds
      }
    );


    /* -------------------------
      TOOLTIP POSITIONING
      ------------------------- */

    const [mx, my] = d3.pointer(event, document.body);

    chartTooltip
      .style("left", `${mx + 12}px`)
      .style("top", `${my - 18}px`)
      .style("display", "block")
      .html(html);
  }
}