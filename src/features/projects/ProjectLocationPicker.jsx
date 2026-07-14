import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import { GeocodingError } from './projectLocationService.js'

const DEFAULT_MAP_CENTER = Object.freeze([36.2048, 138.2529])
const DEFAULT_MAP_ZOOM = 5
const SELECTED_MAP_ZOOM = 16
const NOT_FOUND_MESSAGE = '地址未找到，请补充都道府县、市区町村和番地'
const GEOCODING_RETRY_MESSAGE = '地址定位失败，请稍后重试'
const SERVICE_RETRY_MESSAGE = '地址定位服务暂时不可用，请稍后重试'
const INVALID_RESULT_MESSAGE = '地址定位服务返回了无效位置，请稍后重试'

function toCoordinate(value, minimum, maximum) {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !value.trim())
  ) return null

  const coordinate = Number(value)
  return Number.isFinite(coordinate) && coordinate >= minimum && coordinate <= maximum
    ? coordinate
    : null
}

function toCoordinatePair(latitude, longitude) {
  const nextLatitude = toCoordinate(latitude, -90, 90)
  const nextLongitude = toCoordinate(longitude, -180, 180)
  return nextLatitude === null || nextLongitude === null
    ? null
    : { latitude: nextLatitude, longitude: nextLongitude }
}

function toCircleRadius(value) {
  const radius = Number(value)
  return Number.isFinite(radius) && radius > 0 ? radius : 1
}

export default function ProjectLocationPicker({
  address,
  latitude,
  longitude,
  attendanceRadiusMeters,
  confirmed,
  onLocationConfirmed: locationConfirmedCallback,
  onRadiusChange,
  locateAddress,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const circleRef = useRef(null)
  const updateMapSelectionRef = useRef(null)
  const abortControllerRef = useRef(null)
  const requestIdRef = useRef(0)
  const latestLocateInputRef = useRef({ address, latitude, longitude })
  const mountedRef = useRef(false)
  const locationConfirmedCallbackRef = useRef(locationConfirmedCallback)
  const radiusRef = useRef(toCircleRadius(attendanceRadiusMeters))
  const previousAddressRef = useRef(address)
  const previousCoordinatesRef = useRef({ latitude, longitude })
  const initialSelectionRef = useRef(toCoordinatePair(latitude, longitude))
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState('')

  locationConfirmedCallbackRef.current = locationConfirmedCallback
  latestLocateInputRef.current = { address, latitude, longitude }
  radiusRef.current = toCircleRadius(attendanceRadiusMeters)
  void onRadiusChange

  const cancelPendingLocate = useCallback(() => {
    const controller = abortControllerRef.current
    if (!controller) return

    requestIdRef.current += 1
    abortControllerRef.current = null
    controller.abort()
    if (mountedRef.current) setLocating(false)
  }, [])

  const isLocateInputCurrent = useCallback((requestInput) => {
    const currentInput = latestLocateInputRef.current
    return (
      Object.is(requestInput.address, currentInput.address) &&
      Object.is(requestInput.latitude, currentInput.latitude) &&
      Object.is(requestInput.longitude, currentInput.longitude)
    )
  }, [])

  const confirmCoordinates = useCallback((nextLatitude, nextLongitude, { center = false } = {}) => {
    const selection = toCoordinatePair(nextLatitude, nextLongitude)
    if (!selection) return

    updateMapSelectionRef.current?.(selection.latitude, selection.longitude, { center })
    const onLocationConfirmed = locationConfirmedCallbackRef.current
    if (typeof onLocationConfirmed === 'function') {
      onLocationConfirmed({
        latitude: selection.latitude,
        longitude: selection.longitude,
        confirmedAt: new Date().toISOString(),
      })
    }
  }, [])

  const handleMapClick = useCallback((event) => {
    const selection = toCoordinatePair(event?.latlng?.lat, event?.latlng?.lng)
    if (!selection) return

    cancelPendingLocate()
    setLocateError('')
    confirmCoordinates(selection.latitude, selection.longitude)
  }, [cancelPendingLocate, confirmCoordinates])

  const handleMarkerDragEnd = useCallback((event) => {
    const draggedMarker = event?.target
    const latLng = draggedMarker?.getLatLng?.()
    const selection = toCoordinatePair(latLng?.lat, latLng?.lng)
    if (!selection) return

    cancelPendingLocate()
    setLocateError('')
    confirmCoordinates(selection.latitude, selection.longitude)
  }, [cancelPendingLocate, confirmCoordinates])

  const updateMapSelection = useCallback((nextLatitude, nextLongitude, { center = false } = {}) => {
    const map = mapRef.current
    const selection = toCoordinatePair(nextLatitude, nextLongitude)
    if (!map || !selection) return

    const latLng = L.latLng(selection.latitude, selection.longitude)
    let marker = markerRef.current
    if (!marker) {
      marker = L.marker(latLng, { draggable: true }).addTo(map)
      marker.on('dragend', handleMarkerDragEnd)
      markerRef.current = marker
    } else {
      marker.setLatLng(latLng)
    }

    let circle = circleRef.current
    if (!circle) {
      circle = L.circle(latLng, {
        radius: radiusRef.current,
        color: '#2169cc',
        fillColor: '#2169cc',
        fillOpacity: 0.14,
        weight: 2,
      }).addTo(map)
      circleRef.current = circle
    } else {
      circle.setLatLng(latLng)
    }
    circle.setRadius(radiusRef.current)

    if (center) {
      map.setView(latLng, Math.max(map.getZoom(), SELECTED_MAP_ZOOM))
    }
  }, [handleMarkerDragEnd])

  updateMapSelectionRef.current = updateMapSelection

  useEffect(() => {
    mountedRef.current = true
    const initialSelection = initialSelectionRef.current
    const map = L.map(containerRef.current)
    mapRef.current = map

    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
      attribution: '地理院タイル | © OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map)
    map.setView(
      initialSelection
        ? [initialSelection.latitude, initialSelection.longitude]
        : DEFAULT_MAP_CENTER,
      initialSelection ? SELECTED_MAP_ZOOM : DEFAULT_MAP_ZOOM,
    )
    map.on('click', handleMapClick)

    return () => {
      mountedRef.current = false
      requestIdRef.current += 1
      const controller = abortControllerRef.current
      abortControllerRef.current = null
      controller?.abort()

      map.off('click', handleMapClick)
      const marker = markerRef.current
      if (marker) marker.off('dragend', handleMarkerDragEnd)
      markerRef.current = null
      circleRef.current = null
      mapRef.current = null
      map.remove()
    }
  }, [handleMapClick, handleMarkerDragEnd])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const selection = toCoordinatePair(latitude, longitude)
    if (selection) {
      updateMapSelection(selection.latitude, selection.longitude)
      return
    }

    const marker = markerRef.current
    if (marker) {
      marker.off('dragend', handleMarkerDragEnd)
      marker.remove()
      markerRef.current = null
    }
    circleRef.current?.remove()
    circleRef.current = null
  }, [attendanceRadiusMeters, handleMarkerDragEnd, latitude, longitude, updateMapSelection])

  useEffect(() => {
    if (Object.is(previousAddressRef.current, address)) return
    previousAddressRef.current = address
    cancelPendingLocate()
    setLocateError('')
  }, [address, cancelPendingLocate])

  useEffect(() => {
    const previous = previousCoordinatesRef.current
    if (Object.is(previous.latitude, latitude) && Object.is(previous.longitude, longitude)) return

    previousCoordinatesRef.current = { latitude, longitude }
    cancelPendingLocate()
  }, [cancelPendingLocate, latitude, longitude])

  const handleLocate = async () => {
    const requestInput = { address, latitude, longitude }
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    setLocating(true)
    setLocateError('')

    try {
      const result = await locateAddress(address, { signal: controller.signal })
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        requestId !== requestIdRef.current ||
        !isLocateInputCurrent(requestInput)
      ) return

      if (result === null) {
        setLocateError(NOT_FOUND_MESSAGE)
        return
      }

      const selection = toCoordinatePair(result?.latitude, result?.longitude)
      if (!selection) {
        setLocateError(INVALID_RESULT_MESSAGE)
        return
      }

      confirmCoordinates(selection.latitude, selection.longitude, { center: true })
    } catch (error) {
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        requestId !== requestIdRef.current ||
        !isLocateInputCurrent(requestInput) ||
        error?.name === 'AbortError'
      ) return

      setLocateError(
        error instanceof GeocodingError
          ? GEOCODING_RETRY_MESSAGE
          : SERVICE_RETRY_MESSAGE,
      )
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        if (abortControllerRef.current === controller) abortControllerRef.current = null
        setLocating(false)
      }
    }
  }

  return (
    <section className="project-location-picker" aria-label="施工位置选择">
      <div className="project-location-actions">
        <button
          className="project-location-action"
          type="button"
          onClick={handleLocate}
          disabled={locating}
        >
          {locating ? '定位中…' : '地址定位'}
        </button>
        <span>可点击地图或拖动标记，微调施工位置。</span>
      </div>

      <div
        ref={containerRef}
        className="project-location-map"
        aria-label="项目施工位置地图"
      />

      <p
        className={`project-location-status ${
          confirmed
            ? 'project-location-status-confirmed'
            : 'project-location-status-unconfirmed'
        }`}
        role="status"
      >
        {confirmed ? '施工位置已确认' : '地址已变更，请重新定位'}
      </p>
      <p className="project-location-coordinates">
        纬度：{latitude ?? '未选择'}｜经度：{longitude ?? '未选择'}
      </p>
      {locateError ? (
        <p className="project-location-error" role="alert">
          {locateError}
        </p>
      ) : null}

      <div className="project-location-attribution">
        <span>地图来源：</span>
        <a href="https://maps.gsi.go.jp/help/howtouse.html" target="_blank" rel="noreferrer">
          地理院タイル
        </a>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap contributors
        </a>
      </div>
    </section>
  )
}
