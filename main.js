const csvPath = "hospital_prices_medians_common.csv";

// generous bottom margin so wrapped labels have room
const margin = { top: 30, right: 30, bottom: 140, left: 80 };
const width  = 1100;
const height = 560;

const codeSelect = document.getElementById("codeSelect");
const metaDiv = document.getElementById("meta");
const tt = d3.select("#tooltip");
const fmtMoney = d3.format("$,.0f");

// svg and layers
const svg = d3.select("#chart").append("svg")
  .attr("width", width)
  .attr("height", height);

const plotW = width - margin.left - margin.right;
const plotH = height - margin.top - margin.bottom;

const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
const gAxes = g.append("g").attr("class", "axes");
const gMarks = g.append("g").attr("class", "marks");

const x = d3.scaleBand().range([0, plotW]).padding(0.3);
const y = d3.scaleLinear().range([plotH, 0]);

let rows = [];
let metaByCode = new Map();

d3.csv(csvPath).then(raw => {
  const toNum = v => { const n = +v; return Number.isFinite(n) ? n : NaN; };

  rows = raw.map(d => ({
    code: d["code|1"],
    type: d["code|1|type"] || "",
    desc: d["description"] || "",
    hospital: d["hospital_name"],
    city: d["hospital_city"] || "",
    state: d["hospital_state"] || "",
    medMin: toNum(d["med_min"]),
    medMax: toNum(d["med_max"])
  })).filter(d => d.code && d.hospital && isFinite(d.medMin) && isFinite(d.medMax));

  // code list
  const codes = Array.from(new Set(rows.map(d => d.code))).sort(d3.ascending);
  for (const c of codes) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    codeSelect.appendChild(opt);
  }

  // meta by code
  metaByCode = new Map();
  for (const r of rows) if (!metaByCode.has(r.code)) metaByCode.set(r.code, { type: r.type, desc: r.desc });

  updateChart(codes[0]);
  codeSelect.addEventListener("change", () => updateChart(codeSelect.value));
}).catch(err => {
  console.error("CSV load failed", err);
  g.append("text").attr("x", 0).attr("y", 20).text("Could not load CSV");
});

// helper: wrap long axis labels into tspans up to a width
function wrapText(text, widthPx) {
  text.each(function () {
    const textSel = d3.select(this);
    const words = textSel.text().split(/\s+/).reverse();
    let word;
    let line = [];
    let lineNumber = 0;
    const lineHeight = 1.1; // em
    const yAttr = textSel.attr("y");
    const dy = parseFloat(textSel.attr("dy")) || 0;

    let tspan = textSel.text(null)
      .append("tspan")
      .attr("x", 0)
      .attr("y", yAttr)
      .attr("dy", dy + "em");

    while ((word = words.pop())) {
      line.push(word);
      tspan.text(line.join(" "));
      if (tspan.node().getComputedTextLength() > widthPx) {
        line.pop();
        tspan.text(line.join(" "));
        line = [word];
        tspan = textSel.append("tspan")
          .attr("x", 0)
          .attr("y", yAttr)
          .attr("dy", (++lineNumber * lineHeight + dy) + "em")
          .text(word);
      }
    }
  });
}

function updateChart(codeVal) {
  const meta = metaByCode.get(codeVal) || { type: "", desc: "" };
  metaDiv.textContent = `Code: ${codeVal}   Type: ${meta.type || "NA"}   Description: ${meta.desc || "NA"}`;

  // roll up to one row per hospital for the selected code
  const filtered = rows.filter(r => r.code === codeVal);

  const perHospital = d3.rollups(
    filtered,
    v => {
      const medMin = d3.median(v, d => d.medMin);
      const medMax = d3.median(v, d => d.medMax);
      const mode = arr => {
        const m = d3.rollups(arr, vv => vv.length, d => d)
          .sort((a, b) => d3.descending(a[1], b[1]));
        return m.length ? m[0][0] : "";
      };
      return { medMin, medMax, city: mode(v.map(d => d.city)), state: mode(v.map(d => d.state)) };
    },
    d => d.hospital
  ).map(([hospital, o]) => ({ hospital, ...o }))
   .filter(d => Number.isFinite(d.medMin) && Number.isFinite(d.medMax))
   .sort((a, b) => d3.descending(a.medMax, b.medMax));

  // domains
  x.domain(perHospital.map(d => d.hospital));
  y.domain([0, d3.max(perHospital, d => d.medMax) || 1]).nice();

  // axes
  gAxes.selectAll("*").remove();

  const xAxis = gAxes.append("g")
    .attr("class", "axis x-axis")
    .attr("transform", `translate(0,${plotH})`)
    .call(d3.axisBottom(x));

  // wrap labels to multiple lines
  xAxis.selectAll("text")
    .attr("text-anchor", "middle")
    .attr("dy", "0.9em")
    .call(wrapText, Math.min(140, x.bandwidth()));

  gAxes.append("g")
    .attr("class", "axis y-axis")
    .call(d3.axisLeft(y).ticks(6).tickFormat(v => fmtMoney(v)));

  // clear previous marks
  gMarks.selectAll("*").remove();

  // draw range as vertical line with caps
  const capWidth = d => x.bandwidth() * 0.5; // horizontal size of caps

  // main range line
  gMarks.selectAll(".range-line").data(perHospital, d => d.hospital)
    .join("line")
    .attr("class", "range-line")
    .attr("x1", d => x(d.hospital) + x.bandwidth() / 2)
    .attr("x2", d => x(d.hospital) + x.bandwidth() / 2)
    .attr("y1", d => y(d.medMin))
    .attr("y2", d => y(d.medMax))
    .attr("stroke", "steelblue")
    .attr("stroke-width", 5)
    .attr("stroke-linecap", "butt")
    .on("mousemove", (event, d) => showTip(event, d))
    .on("mouseleave", hideTip);

  // bottom cap
  gMarks.selectAll(".cap-min").data(perHospital, d => d.hospital)
    .join("line")
    .attr("class", "cap-min")
    .attr("x1", d => x(d.hospital) + (x.bandwidth() - capWidth(d)) / 2)
    .attr("x2", d => x(d.hospital) + (x.bandwidth() + capWidth(d)) / 2)
    .attr("y1", d => y(d.medMin))
    .attr("y2", d => y(d.medMin))
    .attr("stroke", "steelblue")
    .attr("stroke-width", 4);

  // top cap
  gMarks.selectAll(".cap-max").data(perHospital, d => d.hospital)
    .join("line")
    .attr("class", "cap-max")
    .attr("x1", d => x(d.hospital) + (x.bandwidth() - capWidth(d)) / 2)
    .attr("x2", d => x(d.hospital) + (x.bandwidth() + capWidth(d)) / 2)
    .attr("y1", d => y(d.medMax))
    .attr("y2", d => y(d.medMax))
    .attr("stroke", "steelblue")
    .attr("stroke-width", 4);
}

// tooltip helpers reused from earlier
function showTip(event, d) {
  tt.style("opacity", 1)
    .style("left", event.pageX + 12 + "px")
    .style("top", event.pageY + 12 + "px")
    .html(`
      <div><strong>${d.hospital}</strong></div>
      <div>${d.city ? d.city + ", " : ""}${d.state}</div>
      <div>Median min ${fmtMoney(d.medMin)}</div>
      <div>Median max ${fmtMoney(d.medMax)}</div>
    `);
}
function hideTip() { tt.style("opacity", 0); }
