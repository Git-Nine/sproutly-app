'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { geocodeToPostcode } from '@/lib/scans-client'

/**
 * "Use my location" postcode fallback (PROJ-3): read the device's location and
 * reverse-geocode it to a German postcode. For photos with no GPS (screenshots,
 * EXIF stripped by messaging apps) or when the photo is skipped. Degrades to
 * manual entry with a toast on every failure path.
 */
export function useLocatePostcode(onFound: (postcode: string) => void) {
  const [locating, setLocating] = useState(false)

  function locate() {
    if (!('geolocation' in navigator)) {
      toast.error("Location isn't available on this device. Please enter your postcode.")
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const pc = await geocodeToPostcode(pos.coords.latitude, pos.coords.longitude)
        if (pc) {
          onFound(pc)
        } else {
          toast.error("We couldn't find a German postcode for your location. Please enter it manually.")
        }
        setLocating(false)
      },
      (err) => {
        toast.error(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Please enter your postcode manually.'
            : "We couldn't get your location. Please enter your postcode manually.",
        )
        setLocating(false)
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    )
  }

  return { locating, locate }
}
