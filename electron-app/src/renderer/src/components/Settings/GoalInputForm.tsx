import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../hooks/use-toast'
import { trpc } from '../../utils/trpc'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Textarea } from '../ui/textarea'

interface GoalInputFormProps {
  onboardingMode?: boolean
  onComplete?: (goals: string) => void
  shouldFocus?: boolean
}

const GoalInputForm = ({
  onboardingMode = false,
  onComplete,
  shouldFocus = false
}: GoalInputFormProps) => {
  const { token } = useAuth()
  const [userProjectsAndGoals, setUserProjectsAndGoals] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const hasContent = userProjectsAndGoals.trim().length > 0

  // Fetch user goals
  const { data: initialProjectsAndGoals, isLoading } = trpc.user.getUserProjectsAndGoals.useQuery(
    { token: token || '' },
    { enabled: !!token }
  )

  // Update goals mutation
  const updateGoalsMutation = trpc.user.updateUserProjectsAndGoals.useMutation({
    onSuccess: (data) => {
      if (data.userProjectsAndGoals && typeof data.userProjectsAndGoals === 'string') {
        setUserProjectsAndGoals(data.userProjectsAndGoals)
      }
      setIsEditing(false)

      if (!onboardingMode) {
        toast({
          title: 'Goals Updated!',
          description: 'Your goals have been successfully updated.'
        })
      }

      // Call onComplete if in onboarding mode
      if (onboardingMode && onComplete) {
        onComplete(userProjectsAndGoals)
      }
    },
    onError: (error) => {
      console.error('Failed to update goals:', error)
      alert('Failed to save goals. Please try again.')
    },
    onSettled: () => {
      setIsSaving(false)
    }
  })

  // Load goals when data is fetched
  useEffect(() => {
    if (initialProjectsAndGoals) {
      setUserProjectsAndGoals(initialProjectsAndGoals)
    }
  }, [initialProjectsAndGoals])

  // Auto-edit mode for onboarding
  useEffect(() => {
    if (onboardingMode) {
      setIsEditing(true)
    }
  }, [onboardingMode])

  useEffect(() => {
    if (shouldFocus) {
      setIsEditing(true)
      setTimeout(() => {
        textareaRef.current?.focus()
        textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
    }
  }, [shouldFocus])

  const handleSave = async () => {
    if (!token) return

    setIsSaving(true)
    updateGoalsMutation.mutate({
      token,
      userProjectsAndGoals
    })
  }

  const handleCancel = () => {
    if (onboardingMode) {
      return
    } else {
      // Reset to original values in settings mode
      if (initialProjectsAndGoals) {
        setUserProjectsAndGoals(initialProjectsAndGoals)
      }
      setIsEditing(false)
    }
  }

  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="pt-6">
          <div className="animate-pulse">
            <div className="h-4 bg-muted rounded w-1/4 mb-4"></div>
            <div className="space-y-3">
              <div className="h-24 bg-muted rounded"></div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card
      className={`bg-card border-border ${
        onboardingMode ? '' : !isEditing ? 'cursor-pointer' : ''
      }`}
      onClick={
        onboardingMode
          ? undefined
          : () => {
              if (!isEditing) setIsEditing(true)
            }
      }
      tabIndex={onboardingMode ? undefined : 0}
      role={onboardingMode ? undefined : 'button'}
      aria-label={!onboardingMode && !isEditing ? 'Click to edit your goals' : undefined}
    >
      <CardHeader>
        <CardTitle className="text-card-foreground">Explain your current work & goals</CardTitle>
        <CardDescription>
          What is your job? What are your hobbies and projects? Details help our AI differentiate
          between your activities and distractions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          {isEditing ? (
            <Textarea
              ref={textareaRef}
              id="userProjectsAndGoals"
              value={userProjectsAndGoals}
              onChange={(e) => setUserProjectsAndGoals(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none bg-input text-foreground placeholder-gray-500"
              rows={3}
              placeholder="I'm working on Cronus - The ai time/distraction tracker software. I'm working on improving the app and getting the first few 1000 users. I'll have to post on reddit and other forums etc."
            />
          ) : (
            <p className="px-3 py-2 bg-input/50 rounded-md text-foreground min-h-12 whitespace-pre-wrap">
              {userProjectsAndGoals || (
                <span className="text-muted-foreground italic">No projects or goals set yet.</span>
              )}
            </p>
          )}
        </div>

        {isEditing && (
          <div className="flex justify-end gap-3 mt-6">
            {!onboardingMode && (
              <Button variant="outline" size="sm" onClick={handleCancel} disabled={isSaving}>
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || (onboardingMode && !hasContent)}
            >
              {isSaving ? 'Saving...' : onboardingMode ? 'Save & Continue' : 'Save Goals'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default GoalInputForm
