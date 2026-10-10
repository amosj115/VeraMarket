"use client";

import React from "react";
import { useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import type { Marker as LeafletMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix default marker icon
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface MapProps {
  latitude: number;
  longitude: number;
  zoom?: number;
  readOnly?: boolean;
  onLocationChange?: (lat: number, lng: number) => void;
  height?: string;
  areaName?: string;
}

function MapContent({ latitude, longitude, readOnly, onLocationChange, areaName }: MapProps): React.ReactElement {
  const [position, setPosition] = useState({ lat: latitude, lng: longitude });
  const [prevCoords, setPrevCoords] = useState({ lat: latitude, lng: longitude });
  const markerRef = useRef<LeafletMarker | null>(null);

  // Sync marker when the parent supplies new coordinates (e.g. geolocation result).
  if (prevCoords.lat !== latitude || prevCoords.lng !== longitude) {
    setPrevCoords({ lat: latitude, lng: longitude });
    setPosition({ lat: latitude, lng: longitude });
  }

  useMapEvents({
    click: (e: { latlng: { lat: number; lng: number } }) => {
      if (!readOnly && onLocationChange) {
        const { lat, lng } = e.latlng;
        setPosition({ lat, lng });
        onLocationChange(lat, lng);
      }
    },
  });

  function handleDragEnd() {
    if (readOnly || !onLocationChange) return;
    const element = markerRef.current;
    if (!element) return;
    const { lat, lng } = element.getLatLng();
    setPosition({ lat, lng });
    onLocationChange(lat, lng);
  }

  return (
      <>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker
          ref={markerRef}
          position={[position.lat, position.lng]}
          draggable={!readOnly}
          eventHandlers={readOnly ? undefined : { dragend: handleDragEnd }}
        >
          <Popup>
            {readOnly ? (
              <div>
                <strong>Listing location</strong>
                {areaName && <><br />{areaName}</>}
              </div>
            ) : (
              <div>
                <strong>Drag to adjust location</strong>
                <br />
                <small>Lat: {position.lat.toFixed(6)}, Lng: {position.lng.toFixed(6)}</small>
              </div>
            )}
          </Popup>
        </Marker>
      </>
    );
}

export function Map({ latitude, longitude, zoom = 14, readOnly = false, onLocationChange, height = "400px", areaName }: MapProps): React.ReactElement {
  return React.createElement(
    MapContainer,
    {
      center: [latitude, longitude],
      zoom: zoom,
      style: { height, width: "100%", borderRadius: "0.5rem" },
      scrollWheelZoom: !readOnly,
      className: "rounded-lg border border-border",
    },
    React.createElement(MapContent, {
      latitude: latitude,
      longitude: longitude,
      zoom: zoom,
      readOnly: readOnly,
      onLocationChange: onLocationChange,
      areaName: areaName,
    })
  ) as unknown as React.ReactElement;
}