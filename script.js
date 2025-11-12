// === MAP IN CHART INITIAL SETUP ===
const mapWidth = document.querySelector("#map").clientWidth;
const mapHeight = document.querySelector("#map").clientHeight;
const chartWidth = document.querySelector("#chart").clientWidth;
const chartHeight = document.querySelector("#chart").clientHeight;

const svg = d3.select("#map").append("svg")
  .attr("width", mapWidth)
  .attr("height", mapHeight);

const g = svg.append("g");
const tileLayer = g.append("g");
const mapLayer = g.append("g");
const tooltip = d3.select("#tooltip");

const projection = d3.geoMercator();
const path = d3.geoPath().projection(projection);

let tourismData = [];
let selectedMunicipality = null;
let activeMunicipalities = new Set();

function safeClassName(name) {
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w-]/g, "_");
}

// --- Nova kontrastna barvna paleta ---
const colorScale = d3.scaleOrdinal([
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728",
  "#9467bd", "#8c564b", "#17becf", "#e377c2"
]);

// --- Load geojson in podatke ---
Promise.all([
  d3.json("vipava_obcine.geojson"),
  d3.csv("turizem_mesecno.csv")
]).then(([geo, data]) => {
  data.forEach(d => {
    for (let key in d) {
      if (key !== "Municipality" && key !== "Month") d[key] = +d[key];
    }
  });
  tourismData = data;

  const nameKey = Object.keys(geo.features[0].properties)
    .find(k => /name|naz|ime|obc/i.test(k)) || Object.keys(geo.features[0].properties)[0];

  const fc = { type: "FeatureCollection", features: geo.features };
  projection.fitSize([mapWidth, mapHeight], fc);

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

  const countries = Array.from(new Set(
    data.columns
      .filter(c => c.endsWith("(Arrivals)"))
      .map(c => c.replace(" (Arrivals)", ""))
  )).sort();

  const select = d3.select("#metric");
  countries.forEach(c => select.append("option").attr("value", c).text(c));
  select.on("change", () => {
    updateMap(geo, nameKey);
    updateLineChart();
  });

  updateMap(geo, nameKey);
  updateLineChart();
});

// === POSODOBITEV MAPE ===
function updateMap(geo, nameKey) {
  mapLayer.selectAll(".label").remove();

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
    .on("click", (event, d) => {
      const name = d.properties[nameKey];
      if (activeMunicipalities.has(name)) {
        activeMunicipalities.delete(name);
      } else {
        activeMunicipalities.add(name);
      }
      updateMap(geo, nameKey);
      updateLineChart();
    })
    .on("mouseenter", (event, d) => {
      const name = d.properties[nameKey];
      if (!activeMunicipalities.has(name)) {
        d3.select(event.currentTarget).attr("fill", "#e0e0e09d");
      }
    })
    .on("mouseleave", (event, d) => {
      const name = d.properties[nameKey];
      if (!activeMunicipalities.has(name)) {
        d3.select(event.currentTarget).attr("fill", "#e0e0e003");
      }
    });

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
      .attr("fill", "#264653")
      .text(name);

    const bbox = textEl.node().getBBox();
    labelGroup.insert("rect", "text")
      .attr("x", bbox.x - 4)
      .attr("y", bbox.y - 3)
      .attr("width", bbox.width + 8)
      .attr("height", bbox.height + 6)
      .attr("fill", "#ffffffc6")
      .style("pointer-events", "none");

    labelGroup.on("click", () => {
      if (activeMunicipalities.has(name)) {
        activeMunicipalities.delete(name);
      } else {
        activeMunicipalities.add(name);
      }
      updateMap(geo, nameKey);
      updateLineChart();
    });
  });
}

// === CHART SETUP ===
const chartSvg = d3.select("#chart").append("svg")
  .attr("width", chartWidth)
  .attr("height", chartHeight);

const margin = { top: 60, right: 40, bottom: 60, left: 80 };
const innerWidth = chartWidth - margin.left - margin.right;
const innerHeight = chartHeight - margin.top - margin.bottom;

const chartG = chartSvg.append("g")
  .attr("transform", `translate(${margin.left},${margin.top})`);

const xScale = d3.scaleBand().padding(0.2);
const yScale = d3.scaleLinear();
const chartTooltip = d3.select("body").append("div")
  .attr("class", "tooltip")
  .style("display", "none");

// === LINE CHART UPDATE ===
function updateLineChart() {
  const country = d3.select("#metric").property("value");
  chartG.selectAll("*").remove();

  const selected = Array.from(activeMunicipalities);
  let datasets = [];

  if (selected.length === 0) {
    const allMonths = Array.from(new Set(tourismData.map(d => d.Month))).sort(d3.ascending);
    const keyArr = `${country} (Arrivals)`;
    const keyOver = `${country} (Overnight stays)`;
    const monthlySum = allMonths.map(m => {
      const rows = tourismData.filter(d => d.Month === m);
      const totalArr = d3.sum(rows, r => r[keyArr]);
      const totalOver = d3.sum(rows, r => r[keyOver]);
      return { Municipality: "All Municipalities", Month: m, Arrivals: totalArr, Overnights: totalOver };
    });
    datasets.push(monthlySum);
  } else {
    selected.forEach(m => {
      const keyArr = `${country} (Arrivals)`;
      const keyOver = `${country} (Overnight stays)`;
      const muniData = tourismData.filter(
        d => d.Municipality.trim().toLowerCase() === m.trim().toLowerCase()
      ).sort((a, b) => d3.ascending(a.Month, b.Month));
      datasets.push(muniData.map(d => ({
        Municipality: m,
        Month: d.Month,
        Arrivals: d[keyArr],
        Overnights: d[keyOver]
      })));
    });
  }

  const months = Array.from(new Set(tourismData.map(d => d.Month))).sort(d3.ascending);
  xScale.domain(months).range([0, innerWidth]);
  yScale.domain([
    0,
    d3.max(datasets.flat(), d => Math.max(d.Arrivals, d.Overnights)) * 1.1
  ]).range([innerHeight, 0]);

  const t = chartSvg.transition().duration(1000).ease(d3.easeCubicInOut);

  const fadeLayer = chartG.append("g").attr("opacity", 0);

  fadeLayer.append("g")
    .call(d3.axisLeft(yScale).tickSize(-innerWidth).tickFormat(""))
    .selectAll("line").attr("stroke", "#e0e0e0");

  fadeLayer.selectAll(".domain").remove();

  fadeLayer.append("g")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScale).tickValues(months.filter((d, i) => i % 3 === 0)))
    .selectAll("text")
    .attr("transform", "rotate(-45)")
    .style("text-anchor", "end");

  fadeLayer.append("g").call(d3.axisLeft(yScale).ticks(6));

  const lineArr = d3.line()
    .x(d => xScale(d.Month) + xScale.bandwidth() / 2)
    .y(d => yScale(d.Arrivals));

  const lineOver = d3.line()
    .x(d => xScale(d.Month) + xScale.bandwidth() / 2)
    .y(d => yScale(d.Overnights));

  datasets.forEach(data => {
    const muni = data[0].Municipality;
    const safe = safeClassName(muni);
    const color = muni === "All Municipalities" ? "#264653" : colorScale(muni);

    fadeLayer.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", 2.5)
      .attr("d", lineArr);

    fadeLayer.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", d3.color(color).brighter(0.7))
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "4,2")
      .attr("d", lineOver);

    fadeLayer.selectAll(".dot-" + safe)
      .data(data)
      .join("circle")
      .attr("class", "dot-" + safe)
      .attr("cx", d => xScale(d.Month) + xScale.bandwidth() / 2)
      .attr("cy", d => yScale(d.Arrivals))
      .attr("r", 4)
      .attr("fill", color)
      .on("mouseenter", (event, d) => showTooltip(event, d))
      .on("mouseleave", hideTooltip);
  });

  fadeLayer.transition(t).attr("opacity", 1);

  fadeLayer.append("text")
    .attr("x", innerWidth / 2)
    .attr("y", -20)
    .attr("text-anchor", "middle")
    .attr("font-weight", "bold")
    .attr("font-size", "16px")
    .text(selected.length === 0 ? "All Municipalities (total)" : selected.join(", "));

  // === BRUSHING TOOLTIP (samo ena občina) ===
  if (datasets.length === 1) {
    const brush = d3.brushX()
      .extent([[0, 0], [innerWidth, innerHeight]])
      .on("end", brushed);

    fadeLayer.append("g").attr("class", "brush").call(brush);

    function brushed(event) {
      const selection = event.selection;
      if (!selection) return;
      const [x0, x1] = selection.map(xScale.invertExtent ? s => s : s => xScale.domain()[Math.round(s / (innerWidth / months.length))]);
      const indices = months.filter(m => {
        const px = xScale(m) + xScale.bandwidth() / 2;
        return px >= selection[0] && px <= selection[1];
      });

      const filtered = datasets[0].filter(d => indices.includes(d.Month));
      if (filtered.length === 0) return;

      const sumArr = d3.sum(filtered, d => d.Arrivals);
      const sumOver = d3.sum(filtered, d => d.Overnights);
      const avgStay = sumOver / sumArr || 0;

      const [mx, my] = d3.pointer(event, document.body);
      chartTooltip
        .style("left", mx + "px")
        .style("top", my - 40 + "px")
        .style("display", "block")
        .html(`<strong>${filtered[0].Municipality}</strong><br>
               Period: ${indices[0]} – ${indices[indices.length - 1]}<br>
               Arrivals: ${sumArr.toLocaleString()}<br>
               Overnights: ${sumOver.toLocaleString()}<br>
               Avg stay: ${avgStay.toFixed(2)} nights`);
    }
  }

  const legend = fadeLayer.append("g").attr("transform", "translate(10,0)");
  const legendData = datasets.map(d => ({
    label: d[0].Municipality,
    color: d[0].Municipality === "All Municipalities"
      ? "#264653"
      : colorScale(d[0].Municipality)
  }));

  legend.selectAll("rect")
    .data(legendData)
    .join("rect")
    .attr("x", 0)
    .attr("y", (d, i) => i * 22)
    .attr("width", 16)
    .attr("height", 16)
    .attr("fill", d => d.color)
    .attr("rx", 3)
    .attr("ry", 3);

  legend.selectAll("text")
    .data(legendData)
    .join("text")
    .attr("x", 26)
    .attr("y", (d, i) => i * 22 + 12)
    .text(d => d.label)
    .style("font-size", "13px")
    .style("fill", "#333");
}

// === TOOLTIP FUNKCIJE ===
function showTooltip(event, d) {
  const [mx, my] = d3.pointer(event, document.body);
  chartTooltip
    .style("left", mx + 10 + "px")
    .style("top", my - 10 + "px")
    .style("display", "block")
    .html(`<strong>${d.Municipality}</strong><br>${d.Month}<br>
           Arrivals: ${d.Arrivals.toLocaleString()}<br>
           Overnights: ${d.Overnights.toLocaleString()}`);
}
function hideTooltip() {
  chartTooltip.style("display", "none");
}
