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
                    def status = bat(
                        script: 'npx playwright test test/verifyUploadedInvoices.spec.js',
                        returnStatus: true
                    )

                    if (status != 0) {
                        echo "Tests failed, but continuing..."
                        currentBuild.result = 'UNSTABLE'
                    }
                }
            }
        }
    }

    post {
        always {
            publishHTML(target: [
                reportDir: 'playwright-report',
                reportFiles: 'index.html',
                reportName: 'Playwright HTML Report'
            ])
        }
    }
}
