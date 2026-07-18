const DEFAULT_CHART_COLORS = Object.freeze([
  'var(--erp-chart-gold)',
  'var(--erp-chart-amber)',
  'var(--erp-chart-bronze)',
  'var(--erp-chart-ivory)',
  'var(--erp-chart-slate)',
  'var(--erp-chart-positive)',
  'var(--erp-chart-negative)',
])

const LINE_KEYS = new Set(['income', 'outflow', 'net'])

function ownValue(value, key, fallback = null) {
  try {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      return fallback
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : fallback
  } catch {
    return fallback
  }
}

function arrayValue(value) {
  try {
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function textValue(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function finiteValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value, minimum, maximum) {
  if (!Number.isFinite(value)) return minimum
  return Math.min(maximum, Math.max(minimum, value))
}

function svgNumber(value) {
  return Math.round(clamp(value, -100000, 100000) * 100) / 100
}

function chartColor(value, index) {
  return typeof value === 'string' && /^var\(--[a-z0-9-]+\)$/iu.test(value)
    ? value
    : DEFAULT_CHART_COLORS[index % DEFAULT_CHART_COLORS.length]
}

function formatValue(formatter, value) {
  if (value === null) return '—'
  try {
    const formatted = typeof formatter === 'function' ? formatter(value) : String(value)
    const output = typeof formatted === 'string' || typeof formatted === 'number'
      ? String(formatted)
      : '—'
    return /NaN|Infinity/u.test(output) ? '—' : output
  } catch {
    return '—'
  }
}

function normalizeDataState(data) {
  const rows = []
  const source = arrayValue(data)
  let invalid = !Array.isArray(data)
  for (let index = 0; index < source.length; index += 1) {
    const row = ownValue(data, index)
    if (row === null || typeof row !== 'object') {
      invalid = true
      continue
    }
    const label = textValue(ownValue(row, 'label'), `数据 ${index + 1}`)
    const value = finiteValue(ownValue(row, 'value'))
    if (value === null) invalid = true
    rows.push({
      key: `${textValue(ownValue(row, 'key'), `item-${index}`)}-${index}`,
      label,
      value,
      color: chartColor(ownValue(row, 'color'), index),
    })
  }
  return { rows, invalid }
}

function normalizeData(data) {
  return normalizeDataState(data).rows
}

function chartLabel(title, description) {
  const safeTitle = textValue(title, '管理图表')
  const safeDescription = textValue(description)
  return safeDescription ? `${safeTitle}。${safeDescription}` : safeTitle
}

function EmptyChartText({ message, x, y }) {
  return (
    <text className="executive-chart-empty-text" x={x} y={y} textAnchor="middle">
      {message}
    </text>
  )
}

function ChartCaption({ title, description }) {
  return (
    <figcaption className="executive-chart-caption">
      <strong>{textValue(title, '管理图表')}</strong>
      {textValue(description) ? <span>{textValue(description)}</span> : null}
    </figcaption>
  )
}

function ChartLegend({ title, rows, valueFormatter }) {
  return (
    <ul className="executive-chart-legend" aria-label={`${textValue(title, '图表')}图例`}>
      {rows.length === 0 ? (
        <li className="executive-chart-legend-empty">暂无数据</li>
      ) : rows.map((row) => {
        const formatted = formatValue(valueFormatter, row.value)
        return (
          <li key={row.key} tabIndex="0" aria-label={`${row.label}：${formatted}`}>
            <span
              className="executive-chart-legend-swatch"
              style={{ '--executive-chart-color': row.color }}
              aria-hidden="true"
            />
            <span>{row.label}</span>
            <strong>{formatted}</strong>
          </li>
        )
      })}
    </ul>
  )
}

function SingleValueTable({ title, rows, valueFormatter }) {
  return (
    <details className="executive-chart-data-details">
      <summary>查看完整数据表</summary>
      <div className="executive-chart-table-scroll">
        <table className="executive-chart-data-table">
          <caption>{textValue(title, '图表')}数据表</caption>
          <thead>
            <tr><th scope="col">项目</th><th scope="col">数值</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan="2">暂无数据</td></tr>
            ) : rows.map((row) => (
              <tr key={row.key}><th scope="row">{row.label}</th><td>{formatValue(valueFormatter, row.value)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

export function DonutChart({ title, description, data, valueFormatter }) {
  const normalized = normalizeDataState(data)
  const rows = normalized.rows
  const invalid = normalized.invalid || rows.some((row) => row.value !== null && row.value < 0)
  const positiveRows = rows.filter((row) => row.value !== null && row.value > 0)
  let maximum = 0
  let displayTotal = 0
  let totalOverflow = false
  for (const row of positiveRows) {
    maximum = Math.max(maximum, row.value)
    if (row.value > Number.MAX_VALUE - displayTotal) totalOverflow = true
    else if (!totalOverflow) displayTotal += row.value
  }
  let normalizedTotal = 0
  if (maximum > 0) {
    for (const row of positiveRows) normalizedTotal += row.value / maximum
  }
  const hasSegments = !invalid && maximum > 0 && normalizedTotal > 0 && Number.isFinite(normalizedTotal)
  let offset = 0
  const message = invalid
    ? '图表数据无效'
    : rows.length === 0
    ? '暂无可展示数据'
    : rows.every((row) => row.value === 0) ? '当前数据均为零' : ''
  const label = chartLabel(title, description)

  return (
    <figure className="executive-chart executive-chart-donut">
      <ChartCaption title={title} description={description} />
      <svg role="img" aria-label={label} viewBox="0 0 320 240">
        <title>{label}</title>
        <circle className="executive-donut-track" cx="160" cy="112" r="70" />
        {hasSegments ? positiveRows.map((row) => {
          const percentage = clamp(((row.value / maximum) / normalizedTotal) * 100, 0, 100)
          const segmentOffset = offset
          offset = clamp(offset + percentage, 0, 100)
          const markLabel = `${row.label}：${formatValue(valueFormatter, row.value)}`
          return (
            <circle
              className="executive-donut-segment"
              key={row.key}
              cx="160"
              cy="112"
              r="70"
              pathLength="100"
              stroke={row.color}
              strokeDasharray={`${svgNumber(percentage)} ${svgNumber(100 - percentage)}`}
              strokeDashoffset={svgNumber(-segmentOffset)}
            >
              <title>{markLabel}</title>
            </circle>
          )
        }) : <EmptyChartText message={message} x="160" y="116" />}
        {hasSegments ? (
          <>
            <text className="executive-donut-total-label" x="160" y="106" textAnchor="middle">合计</text>
            <text className="executive-donut-total-value" x="160" y="128" textAnchor="middle">
              {totalOverflow ? '超出显示范围' : formatValue(valueFormatter, displayTotal)}
            </text>
          </>
        ) : null}
      </svg>
      <ChartLegend title={title} rows={rows} valueFormatter={valueFormatter} />
      <SingleValueTable title={title} rows={rows} valueFormatter={valueFormatter} />
    </figure>
  )
}

function verticalScale(rows) {
  let minimum = 0
  let maximum = 0
  let count = 0
  let allZero = true
  for (const row of rows) {
    if (row.value === null) continue
    count += 1
    minimum = Math.min(minimum, row.value)
    maximum = Math.max(maximum, row.value)
    if (row.value !== 0) allZero = false
  }
  if (count === 0) return { minimum: -1, maximum: 1, empty: true, allZero: false }
  if (minimum === maximum) {
    minimum = -1
    maximum = 1
  }
  return { minimum, maximum, empty: false, allZero }
}

function ratioInRange(value, minimum, maximum) {
  const divisor = Math.max(Math.abs(minimum), Math.abs(maximum), 1)
  const scaledMinimum = minimum / divisor
  const scaledMaximum = maximum / divisor
  const scaledRange = scaledMaximum - scaledMinimum
  if (!Number.isFinite(scaledRange) || scaledRange <= 0) return 0.5
  return clamp(((value / divisor) - scaledMinimum) / scaledRange, 0, 1)
}

export function BarChart({ title, description, data, valueFormatter }) {
  const rows = normalizeData(data)
  const scale = verticalScale(rows)
  const left = 42
  const right = 626
  const top = 24
  const bottom = 224
  const width = right - left
  const height = bottom - top
  const yFor = (value) => clamp(bottom - ratioInRange(value, scale.minimum, scale.maximum) * height, top, bottom)
  const baseline = yFor(0)
  const slot = rows.length > 0 ? width / rows.length : width
  const barWidth = clamp(slot * 0.52, 8, 62)
  const label = chartLabel(title, description)
  const message = scale.empty ? '暂无可展示数据' : scale.allZero ? '当前数据均为零' : ''

  return (
    <figure className="executive-chart executive-chart-bars">
      <ChartCaption title={title} description={description} />
      <svg role="img" aria-label={label} viewBox="0 0 680 280">
        <title>{label}</title>
        <line className="executive-chart-axis" x1={left} x2={right} y1={svgNumber(baseline)} y2={svgNumber(baseline)} />
        {!message ? rows.map((row, index) => {
          if (row.value === null) return null
          const valueY = yFor(row.value)
          const y = row.value >= 0 ? valueY : baseline
          const rectHeight = clamp(Math.abs(baseline - valueY), 0, height)
          const x = clamp(left + slot * index + (slot - barWidth) / 2, left, right - barWidth)
          const markLabel = `${row.label}：${formatValue(valueFormatter, row.value)}`
          return (
            <g key={row.key}>
              <rect
                x={svgNumber(x)}
                y={svgNumber(y)}
                width={svgNumber(barWidth)}
                height={svgNumber(rectHeight)}
                fill={row.color}
              >
                <title>{markLabel}</title>
              </rect>
              <text className="executive-chart-axis-label" x={svgNumber(x + barWidth / 2)} y="252" textAnchor="middle">
                {row.label}
              </text>
            </g>
          )
        }) : <EmptyChartText message={message} x="340" y="126" />}
      </svg>
      <ChartLegend title={title} rows={rows} valueFormatter={valueFormatter} />
      <SingleValueTable title={title} rows={rows} valueFormatter={valueFormatter} />
    </figure>
  )
}

export function HorizontalBarChart({ title, description, data, valueFormatter }) {
  const rows = normalizeData(data)
  const scale = verticalScale(rows)
  const left = 158
  const right = 636
  const top = 24
  const rowHeight = rows.length > 0 ? clamp(210 / rows.length, 26, 54) : 40
  const chartBottom = top + Math.max(rows.length, 1) * rowHeight
  const chartHeight = Math.max(280, chartBottom + 36)
  const xFor = (value) => clamp(left + ratioInRange(value, scale.minimum, scale.maximum) * (right - left), left, right)
  const baseline = xFor(0)
  const label = chartLabel(title, description)
  const message = scale.empty ? '暂无可展示数据' : scale.allZero ? '当前数据均为零' : ''

  return (
    <figure className="executive-chart executive-chart-horizontal-bars">
      <ChartCaption title={title} description={description} />
      <svg role="img" aria-label={label} viewBox={`0 0 680 ${svgNumber(chartHeight)}`}>
        <title>{label}</title>
        <line className="executive-chart-axis" x1={svgNumber(baseline)} x2={svgNumber(baseline)} y1={top} y2={svgNumber(chartBottom)} />
        {!message ? rows.map((row, index) => {
          if (row.value === null) return null
          const valueX = xFor(row.value)
          const x = row.value >= 0 ? baseline : valueX
          const width = clamp(Math.abs(valueX - baseline), 0, right - left)
          const y = top + index * rowHeight + rowHeight * 0.2
          const height = rowHeight * 0.6
          const markLabel = `${row.label}：${formatValue(valueFormatter, row.value)}`
          return (
            <g key={row.key}>
              <text className="executive-chart-axis-label" x="148" y={svgNumber(y + height * 0.72)} textAnchor="end">
                {row.label}
              </text>
              <rect
                x={svgNumber(x)}
                y={svgNumber(y)}
                width={svgNumber(width)}
                height={svgNumber(height)}
                fill={row.color}
              >
                <title>{markLabel}</title>
              </rect>
            </g>
          )
        }) : <EmptyChartText message={message} x="340" y="126" />}
      </svg>
      <ChartLegend title={title} rows={rows} valueFormatter={valueFormatter} />
      <SingleValueTable title={title} rows={rows} valueFormatter={valueFormatter} />
    </figure>
  )
}

function normalizeSeries(series) {
  const output = []
  for (let index = 0; index < arrayValue(series).length; index += 1) {
    const row = ownValue(series, index)
    const key = textValue(ownValue(row, 'key'))
    if (!LINE_KEYS.has(key) || output.some((item) => item.key === key)) continue
    output.push({
      key,
      label: textValue(ownValue(row, 'label'), key),
      color: chartColor(ownValue(row, 'color'), index),
    })
  }
  return output
}

function normalizePoints(points) {
  const output = []
  for (let index = 0; index < arrayValue(points).length; index += 1) {
    const row = ownValue(points, index)
    if (row === null || typeof row !== 'object') continue
    output.push({
      month: textValue(ownValue(row, 'month'), `第 ${index + 1} 期`),
      income: finiteValue(ownValue(row, 'income')),
      outflow: finiteValue(ownValue(row, 'outflow')),
      net: finiteValue(ownValue(row, 'net')),
    })
  }
  return output
}

function lineSegments(points, key, xFor, yFor) {
  const segments = []
  let current = []
  points.forEach((point, index) => {
    const value = point[key]
    if (value === null) {
      if (current.length > 0) segments.push(current)
      current = []
      return
    }
    current.push(`${svgNumber(xFor(index))},${svgNumber(yFor(value))}`)
  })
  if (current.length > 0) segments.push(current)
  return segments
}

function LineDataTable({ title, points, series, valueFormatter }) {
  return (
    <details className="executive-chart-data-details">
      <summary>查看完整数据表</summary>
      <div className="executive-chart-table-scroll">
        <table className="executive-chart-data-table">
          <caption>{textValue(title, '趋势图')}数据表</caption>
          <thead><tr><th scope="col">月份</th>{series.map((item) => <th scope="col" key={item.key}>{item.label}</th>)}</tr></thead>
          <tbody>
            {points.length === 0 ? <tr><td colSpan={series.length + 1}>暂无数据</td></tr> : points.map((point, index) => (
              <tr key={`${point.month}-${index}`}>
                <th scope="row">{point.month}</th>
                {series.map((item) => <td key={item.key}>{formatValue(valueFormatter, point[item.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

export function LineChart({ title, description, points, series, valueFormatter }) {
  const safePoints = normalizePoints(points)
  const safeSeries = normalizeSeries(series)
  let valueCount = 0
  let allValuesZero = true
  let minimum = 0
  let maximum = 0
  for (const point of safePoints) {
    for (const item of safeSeries) {
      const value = point[item.key]
      if (value === null) continue
      valueCount += 1
      minimum = Math.min(minimum, value)
      maximum = Math.max(maximum, value)
      if (value !== 0) allValuesZero = false
    }
  }
  const empty = safePoints.length === 0 || safeSeries.length === 0 || valueCount === 0
  const allZero = !empty && allValuesZero
  if (empty) {
    minimum = -1
    maximum = 1
  }
  if (minimum === maximum) {
    minimum = -1
    maximum = 1
  }
  const left = 50
  const right = 646
  const top = 22
  const bottom = 218
  const xFor = (index) => safePoints.length <= 1
    ? (left + right) / 2
    : left + (index / (safePoints.length - 1)) * (right - left)
  const yFor = (value) => clamp(
    bottom - ratioInRange(value, minimum, maximum) * (bottom - top),
    top,
    bottom,
  )
  const label = chartLabel(title, description)
  const message = empty ? '暂无可展示数据' : allZero ? '当前数据均为零' : ''

  return (
    <figure className="executive-chart executive-chart-line">
      <ChartCaption title={title} description={description} />
      <svg role="img" aria-label={label} viewBox="0 0 680 280">
        <title>{label}</title>
        <line className="executive-chart-axis" x1={left} x2={right} y1={svgNumber(yFor(0))} y2={svgNumber(yFor(0))} />
        {!message ? safeSeries.map((item) => (
          <g key={item.key}>
            {lineSegments(safePoints, item.key, xFor, yFor).map((segment, index) => (
              <polyline
                className="executive-line-series"
                key={`${item.key}-${index}`}
                points={segment.join(' ')}
                stroke={item.color}
              />
            ))}
            {safePoints.map((point, index) => {
              const value = point[item.key]
              if (value === null) return null
              const markLabel = `${point.month} ${item.label}：${formatValue(valueFormatter, value)}`
              return (
                <circle
                  className="executive-line-point"
                  key={`${item.key}-${point.month}-${index}`}
                  cx={svgNumber(xFor(index))}
                  cy={svgNumber(yFor(value))}
                  r="4"
                  fill={item.color}
                >
                  <title>{markLabel}</title>
                </circle>
              )
            })}
          </g>
        )) : <EmptyChartText message={message} x="340" y="126" />}
        {!empty ? safePoints.map((point, index) => (
          <text
            className="executive-chart-axis-label"
            key={`${point.month}-${index}`}
            x={svgNumber(xFor(index))}
            y="252"
            textAnchor="middle"
          >
            {point.month}
          </text>
        )) : null}
      </svg>
      <ChartLegend
        title={title}
        rows={safeSeries.map((item) => ({
          ...item,
          value: safePoints.length > 0 ? safePoints.at(-1)[item.key] : null,
        }))}
        valueFormatter={valueFormatter}
      />
      <LineDataTable title={title} points={safePoints} series={safeSeries} valueFormatter={valueFormatter} />
    </figure>
  )
}
