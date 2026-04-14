pipeline {
    agent any

    stages {

        stage('Install Dependencies') {
            steps {
                echo 'Installing Node dependencies...'
                bat 'npm install'
                bat 'npx playwright install'
            }
        }

        stage('Run E2E Tests') {
            steps {
                script {
                    echo 'Running Playwright tests...'

                    def status = bat(
                        script: 'npx playwright test test/verifyUploadedInvoices.spec.js',
                        returnStatus: true
                    )

                    if (status != 0) {
                        echo 'Tests failed, marking build as UNSTABLE...'
                        currentBuild.result = 'UNSTABLE'
                    }
                }
            }
        }
    }

    post {
        always {
            echo 'Publishing Playwright Report...'

            script {
                if (fileExists('playwright-report/index.html')) {
                    publishHTML([
                        allowMissing: false,
                        alwaysLinkToLastBuild: true,
                        keepAll: true,
                        reportDir: 'playwright-report',
                        reportFiles: 'index.html',
                        reportName: 'Playwright HTML Report'
                    ])
                } else {
                    echo 'No Playwright report found.'
                }
            }
        }
    }
}
