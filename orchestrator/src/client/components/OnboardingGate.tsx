import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check } from "lucide-react"
import { toast } from "sonner"

import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import * as api from "@client/api"
import { useSettings } from "@client/hooks/useSettings"
import { SettingsInput } from "@client/pages/settings/components/SettingsInput"
import { formatSecretHint } from "@client/pages/settings/utils"
import type { ProfileStatusResponse, ResumeProfile } from "@shared/types"

export const OnboardingGate: React.FC = () => {
  const { settings, isLoading: settingsLoading, refreshSettings } = useSettings()
  const [profileStatus, setProfileStatus] = useState<ProfileStatusResponse | null>(null)
  const [isCheckingProfile, setIsCheckingProfile] = useState(false)
  const [isSavingEnv, setIsSavingEnv] = useState(false)
  const [isUploadingResume, setIsUploadingResume] = useState(false)
  const [currentStep, setCurrentStep] = useState<string | null>(null)

  const [openrouterApiKey, setOpenrouterApiKey] = useState("")
  const [rxresumeEmail, setRxresumeEmail] = useState("")
  const [rxresumePassword, setRxresumePassword] = useState("")
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const refreshProfileStatus = useCallback(async () => {
    setIsCheckingProfile(true)
    try {
      const status = await api.getProfileStatus()
      setProfileStatus(status)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to check base resume"
      setProfileStatus({ exists: false, error: message })
    } finally {
      setIsCheckingProfile(false)
    }
  }, [])

  useEffect(() => {
    void refreshProfileStatus()
  }, [refreshProfileStatus])

  const hasOpenrouterKey = Boolean(settings?.openrouterApiKeyHint)
  const hasRxresumeEmail = Boolean(settings?.rxresumeEmail?.trim())
  const hasRxresumePassword = Boolean(settings?.rxresumePasswordHint)
  const hasRxresumeCredentials = hasRxresumeEmail && hasRxresumePassword
  const hasBaseResume = Boolean(profileStatus?.exists)

  const shouldOpen = Boolean(settings && profileStatus && !settingsLoading && !isCheckingProfile)
    && !(hasOpenrouterKey && hasRxresumeCredentials && hasBaseResume)

  const openrouterCurrent = settings?.openrouterApiKeyHint
    ? formatSecretHint(settings.openrouterApiKeyHint)
    : undefined
  const rxresumeEmailCurrent = settings?.rxresumeEmail?.trim()
    ? settings.rxresumeEmail
    : undefined
  const rxresumePasswordCurrent = settings?.rxresumePasswordHint
    ? formatSecretHint(settings.rxresumePasswordHint)
    : undefined

  const steps = useMemo(
    () => [
      {
        id: "openrouter",
        label: "Connect AI",
        subtitle: "OpenRouter key",
        complete: hasOpenrouterKey,
      },
      {
        id: "rxresume",
        label: "PDF Export",
        subtitle: "RxResume login",
        complete: hasRxresumeCredentials,
      },
      {
        id: "resume",
        label: "Resume JSON",
        subtitle: "Upload your file",
        complete: hasBaseResume,
      },
    ],
    [hasBaseResume, hasOpenrouterKey, hasRxresumeCredentials]
  )

  const defaultStep = steps.find((step) => !step.complete)?.id ?? steps[0]?.id

  useEffect(() => {
    if (!shouldOpen) return
    if (!currentStep && defaultStep) {
      setCurrentStep(defaultStep)
    }
  }, [currentStep, defaultStep, shouldOpen])

  const handleRefresh = async () => {
    const results = await Promise.allSettled([refreshSettings(), refreshProfileStatus()])
    const failed = results.find((result) => result.status === "rejected")
    if (failed) {
      const reason = failed.status === "rejected" ? failed.reason : null
      const message = reason instanceof Error ? reason.message : "Failed to refresh setup"
      toast.error(message)
    }
  }

  const handleSaveOpenrouter = async (): Promise<boolean> => {
    const openrouterValue = openrouterApiKey.trim()
    if (hasOpenrouterKey && !openrouterValue) return true
    if (!openrouterValue) {
      toast.info("Add your OpenRouter API key to continue")
      return false
    }

    try {
      setIsSavingEnv(true)
      await api.updateSettings({ openrouterApiKey: openrouterValue })
      await refreshSettings()
      setOpenrouterApiKey("")
      toast.success("OpenRouter connected")
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save OpenRouter key"
      toast.error(message)
      return false
    } finally {
      setIsSavingEnv(false)
    }
  }

  const handleSaveRxresume = async (): Promise<boolean> => {
    const emailValue = rxresumeEmail.trim()
    const passwordValue = rxresumePassword.trim()
    const missing: string[] = []

    if (!hasRxresumeEmail && !emailValue) missing.push("RxResume email")
    if (!hasRxresumePassword && !passwordValue) missing.push("RxResume password")

    if (missing.length > 0) {
      toast.info("Almost there", {
        description: `Missing: ${missing.join(", ")}`,
      })
      return false
    }

    const update: { rxresumeEmail?: string; rxresumePassword?: string } = {}
    if (emailValue) update.rxresumeEmail = emailValue
    if (passwordValue) update.rxresumePassword = passwordValue

    if (Object.keys(update).length === 0) {
      return true
    }

    try {
      setIsSavingEnv(true)
      await api.updateSettings(update)
      await refreshSettings()
      setRxresumePassword("")
      toast.success("RxResume connected")
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save RxResume credentials"
      toast.error(message)
      return false
    } finally {
      setIsSavingEnv(false)
    }
  }

  const handleUploadResume = async (): Promise<boolean> => {
    if (!resumeFile) {
      toast.info("Choose your base.json file")
      return false
    }

    try {
      setIsUploadingResume(true)
      const text = await resumeFile.text()
      let parsed: ResumeProfile
      try {
        parsed = JSON.parse(text) as ResumeProfile
      } catch {
        throw new Error("Resume JSON is invalid. Export the base.json from RxResume.")
      }

      await api.uploadProfile(parsed)
      await refreshProfileStatus()
      setResumeFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
      toast.success("Resume uploaded")
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upload resume"
      toast.error(message)
      return false
    } finally {
      setIsUploadingResume(false)
    }
  }

  const resumeFileName = resumeFile?.name || ""
  const resolvedStepIndex = currentStep ? steps.findIndex((step) => step.id === currentStep) : 0
  const stepIndex = resolvedStepIndex >= 0 ? resolvedStepIndex : 0
  const completedSteps = steps.filter((step) => step.complete).length
  const progressValue = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0
  const isBusy = isSavingEnv || isUploadingResume || settingsLoading || isCheckingProfile
  const canGoBack = stepIndex > 0
  const canGoForward = stepIndex < steps.length - 1
  const primaryLabel = currentStep === "resume"
    ? (hasBaseResume ? "Finish" : "Upload and finish")
    : (currentStep === "openrouter" && !hasOpenrouterKey) || (currentStep === "rxresume" && !hasRxresumeCredentials)
      ? "Save"
      : "Continue"

  const handlePrimaryAction = async () => {
    if (!currentStep) return
    if (currentStep === "openrouter") {
      await handleSaveOpenrouter()
      return
    }
    if (currentStep === "rxresume") {
      await handleSaveRxresume()
      return
    }
    if (currentStep === "resume") {
      if (hasBaseResume) {
        await handleRefresh()
        return
      }
      await handleUploadResume()
    }
  }

  const handleBack = () => {
    if (!canGoBack) return
    setCurrentStep(steps[stepIndex - 1]?.id ?? currentStep)
  }

  if (!shouldOpen || !currentStep) return null

  return (
    <AlertDialog open>
      <AlertDialogContent
        className="max-w-3xl max-h-[90vh] overflow-hidden p-0"
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <div className="space-y-6 px-6 py-6 max-h-[calc(90vh-3.5rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Welcome to Job Ops</AlertDialogTitle>
            <AlertDialogDescription>
              Let’s get your workspace ready. Add your keys and resume once, then the pipeline can run end-to-end.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Tabs value={currentStep} onValueChange={setCurrentStep}>
            <TabsList className="grid h-auto w-full grid-cols-1 gap-2 border-b border-border/60 bg-transparent p-0 text-left sm:grid-cols-3">
              {steps.map((step, index) => {
                const isActive = step.id === currentStep
                const isComplete = step.complete

                return (
                  <FieldLabel
                    key={step.id}
                    className="w-full [&>[data-slot=field]]:border-0 [&>[data-slot=field]]:p-0 [&>[data-slot=field]]:rounded-none"
                  >
                    <TabsTrigger
                      value={step.id}
                      className={cn(
                        "w-full rounded-none border-b-2 border-transparent px-3 py-4 text-left shadow-none",
                        isActive ? "border-primary bg-muted/60 text-foreground" : "text-muted-foreground"
                      )}
                    >
                      <Field orientation="horizontal" className="items-start">
                        <FieldContent>
                          <FieldTitle>{step.label}</FieldTitle>
                          <FieldDescription>{step.subtitle}</FieldDescription>
                        </FieldContent>
                        <span
                          className={cn(
                            "mt-0.5 flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold",
                            isComplete
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {isComplete ? <Check className="h-3.5 w-3.5" /> : index + 1}
                        </span>
                      </Field>
                    </TabsTrigger>
                  </FieldLabel>
                )
              })}
            </TabsList>

            <TabsContent value="openrouter" className="space-y-4 pt-6">
              <div>
                <p className="text-sm font-semibold">Connect OpenRouter</p>
                <p className="text-xs text-muted-foreground">Used for job scoring, summaries, and tailoring.</p>
              </div>
              <SettingsInput
                label="OpenRouter API key"
                inputProps={{
                  name: "openrouterApiKey",
                  value: openrouterApiKey,
                  onChange: (event) => setOpenrouterApiKey(event.target.value),
                }}
                type="password"
                placeholder="sk-or-v1..."
                current={openrouterCurrent}
                helper="Create a key at openrouter.ai"
                disabled={isSavingEnv}
              />
            </TabsContent>

            <TabsContent value="rxresume" className="space-y-4 pt-6">
              <div>
                <p className="text-sm font-semibold">Link your RxResume account</p>
                <p className="text-xs text-muted-foreground">Used to export tailored PDFs.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <SettingsInput
                  label="Email"
                  inputProps={{
                    name: "rxresumeEmail",
                    value: rxresumeEmail,
                    onChange: (event) => setRxresumeEmail(event.target.value),
                  }}
                  placeholder="you@example.com"
                  current={rxresumeEmailCurrent}
                  disabled={isSavingEnv}
                />
                <SettingsInput
                  label="Password"
                  inputProps={{
                    name: "rxresumePassword",
                    value: rxresumePassword,
                    onChange: (event) => setRxresumePassword(event.target.value),
                  }}
                  type="password"
                  placeholder="Enter password"
                  current={rxresumePasswordCurrent}
                  disabled={isSavingEnv}
                />
              </div>
            </TabsContent>

            <TabsContent value="resume" className="space-y-4 pt-6">
              <div>
                <p className="text-sm font-semibold">Upload your resume JSON</p>
                <p className="text-xs text-muted-foreground">Use the JSON export you downloaded from v4.rxresu.me.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <div className="space-y-2">
                  <label htmlFor="resumeFile" className="text-sm font-medium">
                    Resume JSON
                  </label>
                  <Input
                    id="resumeFile"
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => setResumeFile(event.target.files?.[0] ?? null)}
                    disabled={isUploadingResume}
                  />
                  {resumeFileName && (
                    <p className="text-xs text-muted-foreground">Selected: {resumeFileName}</p>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={handleBack} disabled={!canGoBack || isBusy}>
              Back
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={handleRefresh} disabled={isBusy}>
                Refresh status
              </Button>
              <Button onClick={handlePrimaryAction} disabled={isBusy}>
                {isBusy ? "Working..." : primaryLabel}
              </Button>
            </div>
          </div>

          <Progress value={progressValue} className="h-2" />

          <div className="rounded-lg border border-muted bg-muted/30 p-3 text-xs text-muted-foreground">
            Friendly heads-up: pipelines can be slow or a little flaky in alpha. If anything feels off, open a GitHub issue and
            we will take a look.{" "}
            <a
              className="font-semibold text-foreground underline underline-offset-2"
              href="https://github.com/DaKheera47/job-ops/issues"
              target="_blank"
              rel="noreferrer"
            >
              Open an issue
            </a>
            .
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
