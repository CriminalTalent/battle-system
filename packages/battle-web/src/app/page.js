export default function Home() {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold text-center mb-8">
          Battle System
        </h1>
        <div className="text-center">
          <p className="text-gray-300 mb-4">
            실시간 턴제 전투 시스템
          </p>
          <div className="space-y-4">
            <button className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded">
              전투 참가
            </button>
            <br />
            <button className="bg-green-600 hover:bg-green-700 px-6 py-3 rounded">
              관리자 패널
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}