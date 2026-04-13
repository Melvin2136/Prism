pipeline {
    agent any

    stages {
        stage('Install Dependencies') {
            steps {
                bat 'npm install'
                bat 'npx playwright install'
            }
        }

        stage('Run E2E Tests') {
            steps {
                script {
                    // Update: Target the complete PRISM Master validation flow
                    def status = bat(script: 'npx playwright test tests/PRISM/test/verifyUploadedInvoices.spec.js', returnStatus: true)
                    
                    if (status != 0) {
                        echo "Tests failed, but continuing to generate reports..."
                        currentBuild.result = 'UNSTABLE'
                    }
                }
            }
        }
    }

    post {
        always {
            echo 'Generating Playwright HTML reports...'

            publishHTML(target: [
                reportDir: 'playwright-report',
                reportFiles: 'index.html',
                reportName: 'Playwright HTML Report',
                alwaysLinkToLastBuild: true,
                keepAll: true,
                allowMissing: true,
                linkRelative: false
            ])
        }
    }
}
