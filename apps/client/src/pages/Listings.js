import React from "react";
import { useState } from "react";
import ListingCard from "../components/ListingCard";
import { useEffect } from "react";
import axios from "axios";


const BASE_URL = process.env.baseURL ?? 'http://localhost:5050';

const Listings = () => {
    const [listings, setListings] = useState([]);
    const [makesWithModels, setMakesWithModels] = useState({});
    const [categories, setCategories] = useState([]);
    const [positions, setPositions] = useState([]);
    const [constraints, setConstraints] = useState([]);
    const [years, setYears] = useState([]);
    const [isSearchFitment, setIsSearchByFitment] = useState(true);
    const [selectedFitment, setSelectedFitment] = useState(
        { make: '',
          model: '', 
          year: undefined, 
          category: undefined, 
          position: undefined, 
          constraint: undefined });
    const [selectedPartNumber, setSelectedPartNumber] = useState('');
    const [cursor, setCursor] = useState('');

    useEffect(() => {
        const fetchData = async() => {
            const url = new URL(BASE_URL);

            try {
                const [makesWithModels, years, categories, positions, constraints] = await Promise.all([
                    axios.get(`${url}/fitments/makes-with-models`),
                    axios.get(`${url}/fitments/years`),
                    axios.get(`${url}/fitments/categories`),
                    axios.get(`${url}/fitments/positions`),
                    axios.get(`${url}/fitments/constraints`)
                ])
        
                setMakesWithModels(makesWithModels.data);
                setYears(years.data);
                setCategories(categories.data);
                setPositions(positions.data);
                setConstraints(constraints.data);
            } catch (error) {
                console.error('Error fetching fitment data:', error);
            }
        }
        fetchData();
    }, [])

    const handleSearchByFitment = (e) => {
        e.preventDefault();
        
        const url = new URL(BASE_URL);
        url.pathname = '/listings/by-fitment'
        axios.get(url, {
            params: {
                make: selectedFitment.make,
                model: selectedFitment.model,
                year: selectedFitment.year,
                category: selectedFitment.category,
                position: selectedFitment.position,
                constraint: selectedFitment.constraint
            }
        })
        .then(response => {
            setListings(response.data.listings);
            setCursor(response.data.cursor);
            setSelectedPartNumber('');
        })
        .catch(error => {
            console.error('Error searching by fitment:', error);
        });
    }

    const handleSearchByPartNumber = (e) => {
        e.preventDefault();
        
        const url = new URL(BASE_URL);
        url.pathname = `/listings/by-part-number/${selectedPartNumber}`;
        axios.get(url)
        .then(response => {
            setListings(response.data.listings);
            setCursor(response.data.cursor);
            setSelectedFitment({ make: '',
                model: '', 
                year: undefined, 
                category: undefined, 
                position: undefined, 
                constraint: undefined })
        }).catch(err => console.log('Error fetching listings by part number:', err))
    }


    return (
        <div>
            <div>
                <form onSubmit={(e) => handleSearchByFitment(e)}>
                    <select value={selectedFitment.make} onChange={(e) => {setSelectedFitment({...selectedFitment, make: e.target.value})}}>
                        <h2>Find Parts for a Vehicle</h2>
                        <option value=''>Select a make</option>
                        {
                            Object.keys(makesWithModels).map(make => <option key={make} value={make}>{make}</option>)
                        }
                    </ select>
                    <select value={selectedFitment.model} disabled={!selectedFitment.make} onChange={(e) => setSelectedFitment({...selectedFitment, model: e.target.value})}>
                        <option value=''>{selectedFitment.make ? `Select a model` : 'Select a make first'}</option>
                        {
                            makesWithModels[selectedFitment.make]?.map(model => <option key={model} value={model}>{model}</option>)
                        }
                    </select>
                    <select value={selectedFitment.year ?? ""} onChange={(e) => setSelectedFitment({...selectedFitment, year: e.target.value})}>
                        <option value=''>Select a year</option>
                        {
                            years.map(year => <option key={year} value={year}>{year}</option>)
                        }
                    </select>
                    <select value={selectedFitment.category} onChange={(e) => setSelectedFitment({...selectedFitment, category: e.target.value})}>
                        <option value=''>Select a category</option>
                        {
                            categories.map(category => <option key={category} value={category}>{category}</option>)
                        }
                    </select>
                    <select value={selectedFitment.position} onChange={(e) => setSelectedFitment({...selectedFitment, position: e.target.value})}>
                        <option value=''>Select a position</option>
                        {
                            positions.map(position => <option key={position} value={position}>{position}</option>)
                        }
                    </select>
                    <select value={selectedFitment.constraint} onChange={(e) => setSelectedFitment({...selectedFitment, constraint: e.target.value})}>
                        <option value=''>Select a constraint</option>
                        {
                            constraints.map(constraint => <option key={constraint} value={constraint}>{constraint}</option>)
                        }
                    </select>
                    <button type="submit" disabled={!selectedFitment.make.length && !selectedFitment.model.length && !selectedFitment.year}>Search</button>
                </form> 
                <form onSubmit={(e) => handleSearchByPartNumber(e)}>
                    <h2>Search by Part Number </h2>
                    <label>Part Number: </label>
                    <input type="text" value={selectedPartNumber.partNumber} onChange={(e) => setSelectedPartNumber(e.target.value)} />
                    <br/>
                    <button type="submit" disabled={!selectedPartNumber}>Search</button>
                </form>
            </div>
            <div>
                { listings.map(listing =>
                    <ListingCard
                        key={listing.id}
                        listing={listing}
                        onClick={() => {}} /* add something here */
                    />
                )}
            </div>
        </div>
    )
}