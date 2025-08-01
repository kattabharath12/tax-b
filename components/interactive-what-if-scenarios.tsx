
"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { 
  Calculator, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Lightbulb, 
  Brain,
  Target,
  Plus,
  Minus,
  ArrowUpDown,
  Sparkles,
  Info
} from "lucide-react"
import { calculateDeductionComparison, calculateTaxImpactScenarios } from "@/lib/enhanced-tax-calculations"

interface InteractiveWhatIfScenariosProps {
  taxReturn: any
  adjustedGrossIncome: number
  currentItemizedDeductions: number
  filingStatus: string
  dependents: any[]
}

interface CustomScenario {
  id: string
  name: string
  additionalAmount: number
  deductionType: string
}

interface AIRecommendation {
  strategy: string
  description: string
  potentialSavings: number
  difficulty: 'Easy' | 'Medium' | 'Hard'
  timeline: string
}

export function InteractiveWhatIfScenarios({
  taxReturn,
  adjustedGrossIncome,
  currentItemizedDeductions,
  filingStatus,
  dependents
}: InteractiveWhatIfScenariosProps) {
  const [customScenarios, setCustomScenarios] = useState<CustomScenario[]>([])
  const [newScenario, setNewScenario] = useState({
    name: "",
    additionalAmount: "",
    deductionType: "CHARITABLE_CONTRIBUTIONS"
  })
  const [calculations, setCalculations] = useState<any[]>([])
  const [aiRecommendations, setAIRecommendations] = useState<AIRecommendation[]>([])
  const [loadingAI, setLoadingAI] = useState(false)
  const [quickAmount, setQuickAmount] = useState("")
  const [activeTab, setActiveTab] = useState("scenarios")
  const [debugInfo, setDebugInfo] = useState<any>(null)

  // Validate and sanitize input data
  const safeAdjustedGrossIncome = Math.max(0, parseFloat(String(adjustedGrossIncome || 0)))
  const safeCurrentItemizedDeductions = Math.max(0, parseFloat(String(currentItemizedDeductions || 0)))
  const safeFilingStatus = filingStatus || 'SINGLE'
  const safeDependents = Array.isArray(dependents) ? dependents : []

  // Debug logging
  useEffect(() => {
    const debug = {
      originalAGI: adjustedGrossIncome,
      safeAGI: safeAdjustedGrossIncome,
      originalItemized: currentItemizedDeductions,
      safeItemized: safeCurrentItemizedDeductions,
      filingStatus: safeFilingStatus,
      dependentsCount: safeDependents.length,
      taxReturn: {
        id: taxReturn?.id,
        totalIncome: taxReturn?.totalIncome,
        adjustedGrossIncome: taxReturn?.adjustedGrossIncome
      }
    }
    setDebugInfo(debug)
    console.log('🔍 What-If Scenarios Debug Info:', debug)
  }, [adjustedGrossIncome, currentItemizedDeductions, filingStatus, dependents, taxReturn])

  const deductionTypes = [
    { value: "CHARITABLE_CONTRIBUTIONS", label: "Charitable Donations" },
    { value: "MORTGAGE_INTEREST", label: "Mortgage Interest" },
    { value: "STATE_LOCAL_TAXES", label: "State & Local Taxes" },
    { value: "MEDICAL_EXPENSES", label: "Medical Expenses" },
    { value: "BUSINESS_EXPENSES", label: "Business Expenses" },
    { value: "STUDENT_LOAN_INTEREST", label: "Student Loan Interest" },
    { value: "IRA_CONTRIBUTIONS", label: "Retirement Contributions" },
    { value: "OTHER_DEDUCTIONS", label: "Other Deductions" }
  ]

  // Calculate base scenario and custom scenarios
  useEffect(() => {
    // Use safe values and add minimum income if needed for realistic calculations
    const minIncomeForCalculation = Math.max(safeAdjustedGrossIncome, 50000) // Use at least $50k for demo purposes if no income
    
    console.log('🧮 Calculating scenarios with:', {
      income: safeAdjustedGrossIncome,
      minIncome: minIncomeForCalculation,
      itemizedDeductions: safeCurrentItemizedDeductions,
      filingStatus: safeFilingStatus
    })

    const baseScenarios = calculateTaxImpactScenarios(
      minIncomeForCalculation,
      safeFilingStatus,
      safeCurrentItemizedDeductions,
      safeDependents
    )

    // Add custom scenarios
    const customCalculations = customScenarios.map(scenario => {
      const newComparison = calculateDeductionComparison(
        minIncomeForCalculation,
        safeFilingStatus,
        safeCurrentItemizedDeductions + scenario.additionalAmount,
        safeDependents
      )
      
      const baseTaxLiability = baseScenarios[0]?.taxLiability || 0
      const newTaxLiability = newComparison.recommendedMethod === 'itemized'
        ? newComparison.itemizedTaxLiability
        : newComparison.standardTaxLiability

      return {
        scenario: scenario.name,
        description: `${deductionTypes.find(t => t.value === scenario.deductionType)?.label}: +$${scenario.additionalAmount.toLocaleString()}`,
        itemizedDeductions: safeCurrentItemizedDeductions + scenario.additionalAmount,
        taxLiability: newTaxLiability,
        savings: baseTaxLiability - newTaxLiability,
        custom: true,
        id: scenario.id
      }
    })

    console.log('📊 Calculated scenarios:', [...baseScenarios, ...customCalculations])
    setCalculations([...baseScenarios, ...customCalculations])
  }, [safeAdjustedGrossIncome, safeFilingStatus, safeCurrentItemizedDeductions, safeDependents, customScenarios])

  const handleAddCustomScenario = () => {
    if (!newScenario.name || !newScenario.additionalAmount) return

    const scenario: CustomScenario = {
      id: Date.now().toString(),
      name: newScenario.name,
      additionalAmount: parseFloat(newScenario.additionalAmount),
      deductionType: newScenario.deductionType
    }

    setCustomScenarios([...customScenarios, scenario])
    setNewScenario({
      name: "",
      additionalAmount: "",
      deductionType: "CHARITABLE_CONTRIBUTIONS"
    })
  }

  const handleRemoveCustomScenario = (id: string) => {
    setCustomScenarios(customScenarios.filter(s => s.id !== id))
  }

  const handleQuickCalculation = () => {
    if (!quickAmount) return

    const amount = parseFloat(quickAmount)
    const quickScenario: CustomScenario = {
      id: `quick-${Date.now()}`,
      name: `Quick Test: $${amount.toLocaleString()}`,
      additionalAmount: amount,
      deductionType: "OTHER_DEDUCTIONS"
    }

    setCustomScenarios([...customScenarios, quickScenario])
    setQuickAmount("")
  }

  const getAIRecommendations = async () => {
    setLoadingAI(true)
    try {
      // Use minimum income for realistic AI recommendations
      const minIncomeForAI = Math.max(safeAdjustedGrossIncome, 50000)
      
      console.log('🤖 Getting AI recommendations with:', {
        income: minIncomeForAI,
        itemizedDeductions: safeCurrentItemizedDeductions,
        filingStatus: safeFilingStatus
      })

      const response = await fetch('/api/ai/tax-strategies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          adjustedGrossIncome: minIncomeForAI,
          filingStatus: safeFilingStatus,
          currentItemizedDeductions: safeCurrentItemizedDeductions,
          dependents: safeDependents,
          taxReturn: {
            totalIncome: taxReturn?.totalIncome || minIncomeForAI,
            deductionEntries: taxReturn?.deductionEntries || []
          }
        }),
      })

      if (response.ok) {
        const recommendations = await response.json()
        console.log('🎯 Received AI recommendations:', recommendations)
        setAIRecommendations(recommendations)
      } else {
        console.error('AI API response not ok:', response.status, response.statusText)
      }
    } catch (error) {
      console.error('Error getting AI recommendations:', error)
    } finally {
      setLoadingAI(false)
    }
  }

  const baseTaxLiability = calculations[0]?.taxLiability || 0

  return (
    <Card className="border-2 border-blue-200 bg-blue-50/50">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Calculator className="h-5 w-5 text-blue-600" />
          <span>Interactive What-If Scenarios</span>
          <Sparkles className="h-4 w-4 text-yellow-500" />
        </CardTitle>
        <CardDescription>
          Explore how different deduction strategies could impact your taxes with AI-powered recommendations
        </CardDescription>
        
        {/* Debug Information Display */}
        {debugInfo && (process.env.NODE_ENV === 'development' || true) && (
          <Alert className="mt-2 bg-yellow-50 border-yellow-200">
            <Info className="h-4 w-4" />
            <AlertDescription>
              <details className="text-xs">
                <summary className="cursor-pointer font-medium">🔍 Debug Info (Click to expand)</summary>
                <div className="mt-2 space-y-1">
                  <div><strong>Income:</strong> ${debugInfo.safeAGI?.toLocaleString()} (original: ${debugInfo.originalAGI || 'N/A'})</div>
                  <div><strong>Itemized Deductions:</strong> ${debugInfo.safeItemized?.toLocaleString()}</div>
                  <div><strong>Filing Status:</strong> {debugInfo.filingStatus}</div>
                  <div><strong>Dependents:</strong> {debugInfo.dependentsCount}</div>
                  <div><strong>Tax Return ID:</strong> {debugInfo.taxReturn?.id || 'N/A'}</div>
                  <div><strong>Calculations Count:</strong> {calculations.length}</div>
                </div>
              </details>
            </AlertDescription>
          </Alert>
        )}
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
            <TabsTrigger value="calculator">Calculator</TabsTrigger>
            <TabsTrigger value="ai-insights">AI Insights</TabsTrigger>
          </TabsList>

          <TabsContent value="scenarios" className="space-y-4">
            {/* Quick Calculation */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center space-x-2">
                  <ArrowUpDown className="h-4 w-4" />
                  <span>Quick Impact Test</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex space-x-2">
                  <Input
                    type="number"
                    placeholder="Amount ($)"
                    value={quickAmount}
                    onChange={(e) => setQuickAmount(e.target.value)}
                    className="flex-1"
                  />
                  <Button onClick={handleQuickCalculation} disabled={!quickAmount}>
                    <Plus className="h-4 w-4 mr-1" />
                    Test Impact
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Scenario Results */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Tax Impact Scenarios</h4>
                <Badge variant="outline" className="bg-white">
                  Base Tax: ${baseTaxLiability.toLocaleString()}
                </Badge>
              </div>
              
              {calculations.map((scenario, index) => (
                <div 
                  key={scenario.custom ? scenario.id : index} 
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    index === 0 ? 'bg-gray-100 border-gray-300' : 'bg-white border-gray-200'
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <p className="font-medium">{scenario.scenario}</p>
                      {scenario.custom && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveCustomScenario(scenario.id)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">{scenario.description}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">
                      Tax: ${scenario.taxLiability.toLocaleString()}
                    </p>
                    {scenario.savings > 0 ? (
                      <div className="flex items-center text-green-600">
                        <TrendingDown className="h-3 w-3 mr-1" />
                        <span className="text-sm font-medium">
                          Saves: ${scenario.savings.toLocaleString()}
                        </span>
                      </div>
                    ) : scenario.savings < 0 ? (
                      <div className="flex items-center text-red-600">
                        <TrendingUp className="h-3 w-3 mr-1" />
                        <span className="text-sm font-medium">
                          Costs: ${Math.abs(scenario.savings).toLocaleString()}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-500">No change</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="calculator" className="space-y-4">
            {/* Custom Scenario Builder */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Create Custom Scenario</CardTitle>
                <CardDescription>
                  Build your own what-if scenario with specific deduction types and amounts
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="scenarioName">Scenario Name</Label>
                    <Input
                      id="scenarioName"
                      placeholder="e.g., Increase charitable giving"
                      value={newScenario.name}
                      onChange={(e) => setNewScenario({...newScenario, name: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label htmlFor="scenarioAmount">Additional Amount</Label>
                    <Input
                      id="scenarioAmount"
                      type="number"
                      placeholder="0.00"
                      value={newScenario.additionalAmount}
                      onChange={(e) => setNewScenario({...newScenario, additionalAmount: e.target.value})}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="deductionType">Deduction Type</Label>
                  <Select value={newScenario.deductionType} onValueChange={(value) => setNewScenario({...newScenario, deductionType: value})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {deductionTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button 
                  onClick={handleAddCustomScenario}
                  disabled={!newScenario.name || !newScenario.additionalAmount}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Scenario
                </Button>
              </CardContent>
            </Card>

            {/* Custom Scenarios List */}
            {customScenarios.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Your Custom Scenarios</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {customScenarios.map((scenario) => (
                      <div key={scenario.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <p className="font-medium">{scenario.name}</p>
                          <p className="text-sm text-gray-600">
                            {deductionTypes.find(t => t.value === scenario.deductionType)?.label}: 
                            +${scenario.additionalAmount.toLocaleString()}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRemoveCustomScenario(scenario.id)}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="ai-insights" className="space-y-4">
            <div className="text-center">
              <Button 
                onClick={getAIRecommendations}
                disabled={loadingAI}
                size="lg"
                className="mb-4"
              >
                <Brain className="h-4 w-4 mr-2" />
                {loadingAI ? "Analyzing..." : "Get AI Tax Strategies"}
              </Button>
              <p className="text-sm text-gray-600">
                Get personalized tax optimization strategies based on your financial situation
              </p>
            </div>

            {aiRecommendations.length > 0 && (
              <div className="space-y-4">
                <h4 className="font-medium flex items-center space-x-2">
                  <Lightbulb className="h-4 w-4 text-yellow-500" />
                  <span>AI-Powered Tax Strategies</span>
                </h4>
                
                {aiRecommendations.map((recommendation, index) => (
                  <Card key={index} className="border-l-4 border-l-blue-500">
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between mb-2">
                        <h5 className="font-medium text-blue-900">{recommendation.strategy}</h5>
                        <div className="flex space-x-2">
                          <Badge variant="outline" className={
                            recommendation.difficulty === 'Easy' ? 'bg-green-100 text-green-800' :
                            recommendation.difficulty === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }>
                            {recommendation.difficulty}
                          </Badge>
                          <Badge variant="secondary">
                            <Target className="h-3 w-3 mr-1" />
                            ${recommendation.potentialSavings.toLocaleString()}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-gray-700 mb-2">{recommendation.description}</p>
                      <p className="text-sm text-gray-600">
                        <strong>Timeline:</strong> {recommendation.timeline}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {!loadingAI && aiRecommendations.length === 0 && (
              <Alert>
                <Lightbulb className="h-4 w-4" />
                <AlertDescription>
                  Click "Get AI Tax Strategies" to receive personalized recommendations based on your tax situation.
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
