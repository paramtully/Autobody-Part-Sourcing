import { useState, useEffect, useLocation } from "react";
import axios from "axios";

const baseURL = process.env.baseURL ?? 'http://localhost:5050';
const Listing = () => {
    const location = useLocation();
    const listing = location.state?.listing;
    const [photos, setPhotos] = useState([]);
    const [fitments, setFitments] = useState([]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [photos, fitments] = await Promise.all([
                    axios.get(`${baseURL}/listings/photos/${listing.id}`),
                    axios.get(`${baseURL}/listings/fitments/${listing.id}`)
                ]);
                setPhotos(photos.data);
                setFitments(fitments.data);
            } catch (error) {
                console.error('Error fetching data:', error);
            }
        };
        fetchData();
    }, [listing?.id]);

    return (
        <div>
            <h1>{listing.partName}</h1>
            <div className="photos-container">
                {photos.map((photo) => (
                    <img src={photo.url} alt={photo.alt} />
                ))}
            </div>

            <p><span>Part Number: </span> {listing.partNumber}</p>
            <p><span>Part Type: </span> {listing.type}</p>
            <p><span>Manufacturer: </span> {listing.manufacturer}</p>
            <p><span>Certification: </span> {listing.certification}</p>
            <p><span>Part Category: </span> {listing.partCategory}</p>
            <p><span>Part Position: </span> {listing.partPosition}</p>
            <p><span>Part Description: </span> {listing.partDescription}</p>
            <p><span>Part Weight: </span> {listing.partWeightGrams} grams</p>
            <p><span>Part Is Discontinued: </span> {listing.partIsDiscontinued ? 'Yes' : 'No'}</p>

            <p><span>Listing Condition: </span> {listing.condition}</p>
            <p><span>Listing Quantity Available: </span> {listing.quantityAvailable}</p>
            <p><span>Listing Price: </span> $ {listing.priceMinorMin} {listing.priceMinorMax ? `- ${listing.priceMinorMax} ` : ''}{listing.currency}</p>
            <p><span>Listing Estimated Ship Time: </span> {listing.estimatedShipTimeHours}</p>

            <h2>Fitments</h2>
            <ul>
                {fitments.map((fitment) => (
                    <li key={fitment.id}>{fitment.make} {fitment.model} {fitment.year} {fitment.trim ? `(${fitment.trim})` : ''} {fitment.engine ? `(${fitment.engine})` : ''}</li>
                ))}
            </ul>
        </div>
    )
}

export default Listing;