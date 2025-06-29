import { useEffect, useRef, useState } from 'react'
import { Category } from 'shared'
import { useAuth } from '../contexts/AuthContext'
import { trpc } from '../utils/trpc'

export function useDistractionSound(categoryDetails: Category | null | undefined) {
  const { token } = useAuth()
  const { data: electronSettings } = trpc.user.getElectronAppSettings.useQuery(
    { token: token || '' },
    { enabled: !!token }
  )

  const [distractionAudio, setDistractionAudio] = useState<HTMLAudioElement | null>(null)
  const lastPlayedRef = useRef<number | null>(null)

  // On mount, get the audio data URL from the main process and create the Audio object.
  useEffect(() => {
    const loadAudio = async () => {
      // @ts-ignore
      const dataUrl = await window.api?.getAudioDataUrl()
      if (dataUrl) {
        setDistractionAudio(new Audio(dataUrl))
      }
    }
    loadAudio()
  }, [])

  // This effect runs whenever the category details change, to start or stop the sound.
  useEffect(() => {
    if (!distractionAudio || !electronSettings) return

    console.log('[useDistractionSound] Settings updated:', electronSettings)
    const { playDistractionSound, distractionSoundInterval } = electronSettings
    const DISTRACTION_SOUND_INTERVAL_MS = distractionSoundInterval * 1000

    if (!playDistractionSound) {
      console.log('[useDistractionSound] Sound is disabled. Stopping playback.')
      distractionAudio.pause()
      distractionAudio.currentTime = 0
      lastPlayedRef.current = null
      return
    }

    let isDistracting = false
    console.log('[useDistractionSound] categoryDetails:', categoryDetails)

    if (categoryDetails && typeof categoryDetails === 'object' && '_id' in categoryDetails) {
      const fullCategoryDetails = categoryDetails as Category
      if (fullCategoryDetails.isProductive === false) {
        isDistracting = true
      }
    }
    console.log(`[useDistractionSound] isDistracting: ${isDistracting}`)

    if (!isDistracting) {
      console.log('[useDistractionSound] No longer distracting. Stopping sound.')
      distractionAudio.pause()
      distractionAudio.currentTime = 0 // Reset audio to the beginning for the next play
      // Reset last played time when no longer distracting
      lastPlayedRef.current = null
      return
    }

    const checkAndPlay = () => {
      const now = Date.now()
      // If sound has never been played, or if it has been longer than the interval, play it.
      if (!lastPlayedRef.current || now - lastPlayedRef.current > DISTRACTION_SOUND_INTERVAL_MS) {
        console.log('[useDistractionSound] Playing distraction sound')
        distractionAudio.play().catch((e) => console.error('Error playing distraction sound:', e))
        lastPlayedRef.current = now
      }
    }

    // Play immediately on becoming distracting if conditions are met
    checkAndPlay()

    const intervalId = setInterval(checkAndPlay, 1000) // check every second

    // Cleanup function to clear interval
    return () => {
      clearInterval(intervalId)
    }
  }, [categoryDetails, distractionAudio, electronSettings])
}
